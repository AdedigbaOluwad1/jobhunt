import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { isoWeekKey } from '../common/date';
import { AppError } from '../common/errors';
import { dbPath } from '../common/paths';
import type { Application, Extraction, Job, SourceState, SyncRun } from '../generated/prisma/client';
import { NormalizedJob } from '../jobs/normalize';
import { PrismaService } from './prisma.service';

export type UpsertStatus = 'inserted' | 'unchanged' | 'changed';
export type JobWithExtraction = Job & { extraction: Extraction | null };

export interface ListFilters {
  status?: string[];
  filterStatus?: string;
  includeDuplicates?: boolean;
  includeClosed?: boolean;
  company?: string;
  remote?: boolean;
  minScore?: number;
  limit?: number;
}

export interface SaveExtractionInput {
  contentHash: string;
  promptVersion: string;
  model: string;
  roleSummary: string;
  requirements: string[];
  niceToHave: string[];
  stack: string[];
  seniority: string;
  yearsExperienceMin: number | null;
  remotePolicy: string;
  locationRestriction: string | null;
  matchScore: number;
  matchReasons: string[];
  gaps: string[];
  redFlags: string[];
}

@Injectable()
export class JobsRepository {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * All queries go through this getter instead of the injected service directly:
   * Nest constructs every provider in the module graph up front (even for
   * commands like `init` that don't touch the db), so a constructor-time check
   * would fire before `init` has had a chance to create $JOBHUNT_HOME. Checking
   * lazily here, at actual query time, gives a clear error instead of the raw
   * "directory does not exist" thrown by better-sqlite3.
   */
  private get prisma(): PrismaService {
    if (!fs.existsSync(dbPath())) {
      throw new AppError('CONFIG_MISSING', `jobhunt database not found at ${dbPath()}. Run \`jobhunt init\` first.`);
    }
    return this.prismaService;
  }

  async upsertJob(
    job: NormalizedJob,
    filterResult: { status: string; reason: string | null },
  ): Promise<{ job: Job; status: UpsertStatus }> {
    const existing = await this.prisma.job.findUnique({
      where: { source_board_externalId: { source: job.source, board: job.board, externalId: job.externalId } },
    });

    if (!existing) {
      const created = await this.prisma.job.create({
        data: {
          source: job.source,
          board: job.board,
          externalId: job.externalId,
          company: job.company,
          title: job.title,
          location: job.location,
          remote: job.remote,
          department: job.department,
          employmentType: job.employmentType,
          salaryText: job.salaryText,
          url: job.url,
          applyUrl: job.applyUrl,
          descriptionText: job.descriptionText,
          postedAt: job.postedAt,
          contentHash: job.contentHash,
          dedupeKey: job.dedupeKey,
          filterStatus: filterResult.status,
          filterReason: filterResult.reason,
        },
      });
      return { job: created, status: 'inserted' };
    }

    if (existing.contentHash === job.contentHash) {
      const updated = await this.prisma.job.update({
        where: { id: existing.id },
        data: { lastSeenAt: new Date(), closedAt: null },
      });
      return { job: updated, status: 'unchanged' };
    }

    const updated = await this.prisma.job.update({
      where: { id: existing.id },
      data: {
        company: job.company,
        title: job.title,
        location: job.location,
        remote: job.remote,
        department: job.department,
        employmentType: job.employmentType,
        salaryText: job.salaryText,
        url: job.url,
        applyUrl: job.applyUrl,
        descriptionText: job.descriptionText,
        postedAt: job.postedAt,
        contentHash: job.contentHash,
        dedupeKey: job.dedupeKey,
        lastSeenAt: new Date(),
        closedAt: null,
        filterStatus: filterResult.status,
        filterReason: filterResult.reason,
      },
    });
    return { job: updated, status: 'changed' };
  }

  async findExistingByKey(source: string, board: string, externalId: string): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { source_board_externalId: { source, board, externalId } } });
  }

  /** Another non-closed job with the same dedupeKey from a different (source, board), if any. */
  async findDuplicateCandidate(
    dedupeKey: string,
    excludeSource: string,
    excludeBoard: string,
  ): Promise<{ id: number; source: string } | null> {
    const match = await this.prisma.job.findFirst({
      where: {
        dedupeKey,
        closedAt: null,
        NOT: { source: excludeSource, board: excludeBoard },
      },
      orderBy: { firstSeenAt: 'asc' },
      select: { id: true, source: true },
    });
    return match;
  }

  async setDuplicateOf(jobId: number, duplicateOfId: number | null): Promise<void> {
    await this.prisma.job.update({ where: { id: jobId }, data: { duplicateOfId } });
  }

  /**
   * Sorting/limiting happens in JS, not SQL: the default order is matchScore
   * desc (nulls last) then firstSeenAt desc, and SQLite's NULLS ordering via
   * Prisma's relation orderBy isn't worth fighting at this scale (a personal
   * tool's job table is at most a few thousand rows).
   */
  async findForList(filters: ListFilters): Promise<JobWithExtraction[]> {
    const jobs = await this.prisma.job.findMany({
      where: {
        status: filters.status ? { in: filters.status } : undefined,
        filterStatus: filters.filterStatus,
        duplicateOfId: filters.includeDuplicates ? undefined : null,
        closedAt: filters.includeClosed ? undefined : null,
        company: filters.company ? { contains: filters.company } : undefined,
        remote: filters.remote,
      },
      include: { extraction: true },
    });

    const filtered =
      filters.minScore === undefined
        ? jobs
        : jobs.filter((job) => (job.extraction?.matchScore ?? -1) >= filters.minScore!);

    filtered.sort((a, b) => {
      const scoreA = a.extraction?.matchScore ?? -1;
      const scoreB = b.extraction?.matchScore ?? -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return b.firstSeenAt.getTime() - a.firstSeenAt.getTime();
    });

    return filtered.slice(0, filters.limit ?? 20);
  }

  async findById(id: number): Promise<JobWithExtraction | null> {
    return this.prisma.job.findUnique({ where: { id }, include: { extraction: true } });
  }

  async createSyncRun(): Promise<SyncRun> {
    return this.prisma.syncRun.create({ data: {} });
  }

  async finishSyncRun(id: number, stats: unknown): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: { finishedAt: new Date(), stats: JSON.stringify(stats) },
    });
  }

  async upsertSourceState(input: {
    source: string;
    board: string;
    lastOk: boolean;
    lastError?: string | null;
    lastJobCount: number;
  }): Promise<void> {
    await this.prisma.sourceState.upsert({
      where: { source_board: { source: input.source, board: input.board } },
      create: {
        source: input.source,
        board: input.board,
        lastFetchedAt: new Date(),
        lastOk: input.lastOk,
        lastError: input.lastError ?? null,
        lastJobCount: input.lastJobCount,
      },
      update: {
        lastFetchedAt: new Date(),
        lastOk: input.lastOk,
        lastError: input.lastError ?? null,
        lastJobCount: input.lastJobCount,
      },
    });
  }

  async getSourceStates(): Promise<SourceState[]> {
    return this.prisma.sourceState.findMany({ orderBy: [{ source: 'asc' }, { board: 'asc' }] });
  }

  async getSourceState(source: string, board: string): Promise<SourceState | null> {
    return this.prisma.sourceState.findUnique({ where: { source_board: { source, board } } });
  }

  /** Every non-closed job, for re-running filters against the current config (spec 9.2). */
  async findAllNonClosed(): Promise<Job[]> {
    return this.prisma.job.findMany({ where: { closedAt: null } });
  }

  async updateFilterResult(id: number, status: string, reason: string | null): Promise<void> {
    await this.prisma.job.update({ where: { id }, data: { filterStatus: status, filterReason: reason } });
  }

  /**
   * Closes every previously-known, non-closed job for (source, board) that
   * wasn't in this fetch's full listing. Only call this after a fetch that
   * succeeded and returned the complete listing — a partial/failed fetch must
   * never be treated as "these jobs are gone".
   */
  async closeMissingJobs(source: string, board: string, presentExternalIds: string[]): Promise<number> {
    const result = await this.prisma.job.updateMany({
      where: { source, board, closedAt: null, externalId: { notIn: presentExternalIds } },
      data: { closedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Jobs due for (re-)extraction: filter-passed, not a duplicate, not closed,
   * and either never extracted or stale (content changed or the prompt did).
   * Comparing job.contentHash against extraction.contentHash across the
   * relation isn't a single Prisma where-clause, so the candidate set is
   * filtered/sorted in JS — fine at this scale.
   */
  async findJobsNeedingExtraction(promptVersion: string, limit: number): Promise<JobWithExtraction[]> {
    const candidates = await this.prisma.job.findMany({
      where: { filterStatus: 'passed', duplicateOfId: null, closedAt: null },
      include: { extraction: true },
    });

    const due = candidates.filter((job) => {
      const ext = job.extraction;
      return !ext || ext.contentHash !== job.contentHash || ext.promptVersion !== promptVersion;
    });

    due.sort((a, b) => {
      if (!a.postedAt && !b.postedAt) return 0;
      if (!a.postedAt) return 1;
      if (!b.postedAt) return -1;
      return b.postedAt.getTime() - a.postedAt.getTime();
    });

    return due.slice(0, limit);
  }

  async saveExtraction(jobId: number, data: SaveExtractionInput): Promise<void> {
    const payload = {
      contentHash: data.contentHash,
      promptVersion: data.promptVersion,
      model: data.model,
      roleSummary: data.roleSummary,
      requirements: JSON.stringify(data.requirements),
      niceToHave: JSON.stringify(data.niceToHave),
      stack: JSON.stringify(data.stack),
      seniority: data.seniority,
      yearsExperienceMin: data.yearsExperienceMin,
      remotePolicy: data.remotePolicy,
      locationRestriction: data.locationRestriction,
      matchScore: data.matchScore,
      matchReasons: JSON.stringify(data.matchReasons),
      gaps: JSON.stringify(data.gaps),
      redFlags: JSON.stringify(data.redFlags),
    };
    await this.prisma.extraction.upsert({
      where: { jobId },
      create: { jobId, ...payload },
      update: payload,
    });
  }

  async findApplicationByJobId(jobId: number): Promise<Application | null> {
    return this.prisma.application.findFirst({ where: { jobId }, orderBy: { createdAt: 'desc' } });
  }

  async createApplication(input: { jobId: number; cvPdfPath: string; tailoredJson: string }): Promise<Application> {
    return this.prisma.application.create({ data: input });
  }

  async updateStatus(jobId: number, status: string, note?: string): Promise<Job> {
    return this.prisma.job.update({
      where: { id: jobId },
      data: { status, statusNote: note, statusUpdatedAt: new Date() },
    });
  }

  /** Sets appliedAt on the most recent Application for this job, if it isn't already set. */
  async markLatestApplicationApplied(jobId: number): Promise<void> {
    const application = await this.findApplicationByJobId(jobId);
    if (application && !application.appliedAt) {
      await this.prisma.application.update({ where: { id: application.id }, data: { appliedAt: new Date() } });
    }
  }

  async getStats(): Promise<StatsResult> {
    const jobs = await this.prisma.job.findMany({
      select: { id: true, status: true, firstSeenAt: true, source: true, filterStatus: true, extraction: { select: { matchScore: true } } },
    });
    const applications = await this.prisma.application.findMany({ select: { createdAt: true, jobId: true } });
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    const byStatus: Record<string, number> = {};
    const seenPerWeek = new Map<string, number>();
    const applicationsPerWeek = new Map<string, number>();
    const sourceMatchCounts = new Map<string, number>();
    const appliedScores: number[] = [];

    for (const job of jobs) {
      byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
      const week = isoWeekKey(job.firstSeenAt);
      seenPerWeek.set(week, (seenPerWeek.get(week) ?? 0) + 1);
      if (job.filterStatus === 'passed' && job.extraction) {
        sourceMatchCounts.set(job.source, (sourceMatchCounts.get(job.source) ?? 0) + 1);
      }
    }

    for (const application of applications) {
      const week = isoWeekKey(application.createdAt);
      applicationsPerWeek.set(week, (applicationsPerWeek.get(week) ?? 0) + 1);
      const job = jobById.get(application.jobId);
      if (job?.extraction) appliedScores.push(job.extraction.matchScore);
    }

    const toSortedWeeks = (map: Map<string, number>) =>
      [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));

    const topSource = [...sourceMatchCounts.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      byStatus,
      seenPerWeek: toSortedWeeks(seenPerWeek),
      applicationsPerWeek: toSortedWeeks(applicationsPerWeek),
      avgAppliedMatchScore: appliedScores.length ? appliedScores.reduce((a, b) => a + b, 0) / appliedScores.length : null,
      topSourceByMatches: topSource ? { source: topSource[0], count: topSource[1] } : null,
    };
  }
}

export interface StatsResult {
  byStatus: Record<string, number>;
  seenPerWeek: Array<{ week: string; count: number }>;
  applicationsPerWeek: Array<{ week: string; count: number }>;
  avgAppliedMatchScore: number | null;
  topSourceByMatches: { source: string; count: number } | null;
}
