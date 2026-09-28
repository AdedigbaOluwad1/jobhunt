import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { dbPath } from '../common/paths';
import type { Job, SourceState, SyncRun } from '../generated/prisma/client';
import { NormalizedJob } from '../jobs/normalize';
import { PrismaService } from './prisma.service';

export type UpsertStatus = 'inserted' | 'unchanged' | 'changed';

export interface ListFilters {
  status?: string[];
  filterStatus?: string;
  includeDuplicates?: boolean;
  includeClosed?: boolean;
  company?: string;
  remote?: boolean;
  limit?: number;
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

  async findForList(filters: ListFilters): Promise<Job[]> {
    return this.prisma.job.findMany({
      where: {
        status: filters.status ? { in: filters.status } : undefined,
        filterStatus: filters.filterStatus,
        duplicateOfId: filters.includeDuplicates ? undefined : null,
        closedAt: filters.includeClosed ? undefined : null,
        company: filters.company ? { contains: filters.company } : undefined,
        remote: filters.remote,
      },
      orderBy: { firstSeenAt: 'desc' },
      take: filters.limit ?? 20,
    });
  }

  async findById(id: number): Promise<Job | null> {
    return this.prisma.job.findUnique({ where: { id } });
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
}
