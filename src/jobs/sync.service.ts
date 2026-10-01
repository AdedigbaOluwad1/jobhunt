import { Injectable } from '@nestjs/common';
import { withLimit } from '../common/limiter';
import { ConfigService } from '../config/config.service';
import { JobsRepository } from '../db/jobs.repository';
import { RawJob, JobSource, SourceTarget } from '../sources/source.interface';
import { SourcesService } from '../sources/sources.service';
import { resolveDuplicate } from './dedupe';
import { ExtractorService } from './extractor.service';
import { FilterResult, FilterService } from './filter.service';
import { MANUAL_SOURCE } from './manual-job.service';
import { normalize } from './normalize';

export interface SyncOptions {
  /** "greenhouse" or "greenhouse:stripe" */
  sourceFilter?: string;
  dryRun?: boolean;
  noExtract?: boolean;
  maxExtract?: number;
}

export interface FailedTarget {
  source: string;
  board: string;
  error: string;
}

export interface SkippedTarget {
  source: string;
  board: string;
  reason: string;
}

export interface SyncStats {
  targetsOk: number;
  targetsFailed: number;
  failedTargets: FailedTarget[];
  targetsSkipped: number;
  skippedTargets: SkippedTarget[];
  fetched: number;
  inserted: number;
  changed: number;
  unchanged: number;
  closed: number;
  duplicates: number;
  filterPassed: number;
  filterRejected: number;
  filterReasonCounts: Record<string, number>;
  /** Non-closed jobs whose filterStatus flipped on re-check, e.g. after editing config.yaml. */
  reclassified: number;
  extracted: number;
  extractionFailed: number;
  llmInputTokens: number;
  llmOutputTokens: number;
  extractionSkippedReason?: string;
  newMatches: NewMatch[];
}

export interface NewMatch {
  id: number;
  score: number;
  company: string;
  title: string;
  location: string;
}

interface FetchOutcome {
  target: SourceTarget;
  rawJobs: RawJob[];
  ok: boolean;
}

function formatHoursAgo(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return `${Math.round(hours)}h`;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sourcesService: SourcesService,
    private readonly jobsRepository: JobsRepository,
    private readonly filterService: FilterService,
    private readonly extractorService: ExtractorService,
  ) {}

  async sync(options: SyncOptions = {}): Promise<SyncStats> {
    const config = this.configService.load();
    const syncRun = options.dryRun ? null : await this.jobsRepository.createSyncRun();
    const limit = withLimit(config.sync.httpConcurrency);

    const stats: SyncStats = {
      targetsOk: 0,
      targetsFailed: 0,
      failedTargets: [],
      targetsSkipped: 0,
      skippedTargets: [],
      fetched: 0,
      inserted: 0,
      changed: 0,
      unchanged: 0,
      closed: 0,
      duplicates: 0,
      filterPassed: 0,
      filterRejected: 0,
      filterReasonCounts: {},
      reclassified: 0,
      extracted: 0,
      extractionFailed: 0,
      llmInputTokens: 0,
      llmOutputTokens: 0,
      newMatches: [],
    };

    const insertedJobIds: number[] = [];
    const targets = this.collectTargets(options.sourceFilter);
    const fetchResults = await Promise.all(targets.map((t) => limit(() => this.fetchTarget(t, options, stats))));

    for (const result of fetchResults) {
      stats.fetched += result.rawJobs.length;

      for (const raw of result.rawJobs) {
        await this.processRawJob(raw, options, stats, insertedJobIds);
      }

      if (!options.dryRun && result.ok) {
        const presentIds = result.rawJobs.map((j) => j.externalId);
        stats.closed += await this.jobsRepository.closeMissingJobs(result.target.source, result.target.board, presentIds);
      }
    }

    if (!options.dryRun) {
      await this.reevaluateFilters(stats);
    }

    if (!options.dryRun && !options.noExtract) {
      const maxExtract = options.maxExtract ?? config.sync.maxExtractPerRun;
      const extraction = await this.extractorService.extractDue(maxExtract);
      stats.extracted = extraction.succeeded;
      stats.extractionFailed = extraction.failed;
      stats.llmInputTokens = extraction.inputTokens;
      stats.llmOutputTokens = extraction.outputTokens;
      stats.extractionSkippedReason = extraction.skippedReason;
    }

    if (!options.dryRun && insertedJobIds.length > 0) {
      stats.newMatches = await this.collectNewMatches(insertedJobIds, config.sync.minScoreToHighlight);
    }

    if (syncRun) {
      await this.jobsRepository.finishSyncRun(syncRun.id, stats);
    }

    return stats;
  }

  private async fetchTarget(
    { source, target }: { source: JobSource; target: SourceTarget },
    options: SyncOptions,
    stats: SyncStats,
  ): Promise<FetchOutcome> {
    if (target.minIntervalHours) {
      const state = await this.jobsRepository.getSourceState(target.source, target.board);
      if (state?.lastFetchedAt) {
        const hoursSinceFetch = (Date.now() - state.lastFetchedAt.getTime()) / 3_600_000;
        if (hoursSinceFetch < target.minIntervalHours) {
          const reason = `fetched ${formatHoursAgo(hoursSinceFetch)} ago`;
          stats.targetsSkipped++;
          stats.skippedTargets.push({ source: target.source, board: target.board, reason });
          return { target, rawJobs: [], ok: false };
        }
      }
    }

    try {
      const rawJobs = await source.fetch(target);
      stats.targetsOk++;
      if (!options.dryRun) {
        await this.jobsRepository.upsertSourceState({
          source: target.source,
          board: target.board,
          lastOk: true,
          lastJobCount: rawJobs.length,
        });
      }
      return { target, rawJobs, ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      stats.targetsFailed++;
      stats.failedTargets.push({ source: target.source, board: target.board, error: message });
      if (!options.dryRun) {
        await this.jobsRepository.upsertSourceState({
          source: target.source,
          board: target.board,
          lastOk: false,
          lastError: message,
          lastJobCount: 0,
        });
      }
      return { target, rawJobs: [], ok: false };
    }
  }

  private async processRawJob(raw: RawJob, options: SyncOptions, stats: SyncStats, insertedJobIds: number[]): Promise<void> {
    const normalized = normalize(raw);
    const filterResult = this.filterService.evaluate(normalized);

    if (options.dryRun) {
      const existing = await this.jobsRepository.findExistingByKey(
        normalized.source,
        normalized.board,
        normalized.externalId,
      );
      if (!existing) stats.inserted++;
      else if (existing.contentHash === normalized.contentHash) {
        stats.unchanged++;
        return;
      } else stats.changed++;
      this.tallyFilterResult(stats, filterResult);
      return;
    }

    const { job, status } = await this.jobsRepository.upsertJob(normalized, filterResult);

    if (status === 'unchanged') {
      stats.unchanged++;
      return;
    }
    this.tallyFilterResult(stats, filterResult);

    if (status === 'changed') {
      stats.changed++;
      return;
    }

    stats.inserted++;
    insertedJobIds.push(job.id);
    const duplicate = await this.jobsRepository.findDuplicateCandidate(job.dedupeKey, job.source, job.board);
    const resolution = resolveDuplicate({ source: job.source }, duplicate);
    if (resolution.newJobDuplicateOfId !== null) {
      await this.jobsRepository.setDuplicateOf(job.id, resolution.newJobDuplicateOfId);
      stats.duplicates++;
    } else if (resolution.swapExistingId !== null) {
      await this.jobsRepository.setDuplicateOf(resolution.swapExistingId, job.id);
      stats.duplicates++;
    }
  }

  private tallyFilterResult(stats: SyncStats, filterResult: FilterResult): void {
    if (filterResult.status === 'passed') {
      stats.filterPassed++;
      return;
    }
    stats.filterRejected++;
    const key = filterResult.reason ?? 'unknown';
    stats.filterReasonCounts[key] = (stats.filterReasonCounts[key] ?? 0) + 1;
  }

  /** Re-checks every non-closed job against the current config, so editing config.yaml takes effect without a refetch. */
  private async reevaluateFilters(stats: SyncStats): Promise<void> {
    const jobs = await this.jobsRepository.findAllNonClosed();
    for (const job of jobs) {
      if (job.source === MANUAL_SOURCE) continue;
      const result = this.filterService.evaluate(job);
      if (result.status !== job.filterStatus || result.reason !== job.filterReason) {
        await this.jobsRepository.updateFilterResult(job.id, result.status, result.reason);
        stats.reclassified++;
      }
    }
  }

  private async collectNewMatches(insertedJobIds: number[], minScore: number): Promise<NewMatch[]> {
    const jobs = await this.jobsRepository.findByIds(insertedJobIds);
    return jobs
      .filter((job) => job.filterStatus === 'passed' && !job.duplicateOfId && (job.extraction?.matchScore ?? -1) >= minScore)
      .map((job) => ({
        id: job.id,
        score: job.extraction!.matchScore,
        company: job.company,
        title: job.title,
        location: job.remote ? 'remote' : (job.location ?? ''),
      }))
      .sort((a, b) => b.score - a.score);
  }

  private collectTargets(sourceFilter?: string): Array<{ source: JobSource; target: SourceTarget }> {
    const [filterSource, filterBoard] = sourceFilter ? sourceFilter.split(':') : [undefined, undefined];
    const result: Array<{ source: JobSource; target: SourceTarget }> = [];
    for (const source of this.sourcesService.all()) {
      if (filterSource && source.name !== filterSource) continue;
      for (const target of source.targets()) {
        if (filterBoard && target.board !== filterBoard) continue;
        result.push({ source, target });
      }
    }
    return result;
  }
}
