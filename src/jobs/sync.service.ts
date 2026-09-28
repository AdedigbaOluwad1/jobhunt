import { Injectable } from '@nestjs/common';
import { withLimit } from '../common/limiter';
import { ConfigService } from '../config/config.service';
import { JobsRepository } from '../db/jobs.repository';
import { JobSource, SourceTarget } from '../sources/source.interface';
import { SourcesService } from '../sources/sources.service';
import { resolveDuplicate } from './dedupe';
import { normalize } from './normalize';

export interface SyncOptions {
  /** "greenhouse" or "greenhouse:stripe" */
  sourceFilter?: string;
  dryRun?: boolean;
}

export interface FailedTarget {
  source: string;
  board: string;
  error: string;
}

export interface SyncStats {
  targetsOk: number;
  targetsFailed: number;
  failedTargets: FailedTarget[];
  fetched: number;
  inserted: number;
  changed: number;
  unchanged: number;
  duplicates: number;
}

@Injectable()
export class SyncService {
  constructor(
    private readonly configService: ConfigService,
    private readonly sourcesService: SourcesService,
    private readonly jobsRepository: JobsRepository,
  ) {}

  async sync(options: SyncOptions = {}): Promise<SyncStats> {
    const config = this.configService.load();
    const syncRun = options.dryRun ? null : await this.jobsRepository.createSyncRun();
    const limit = withLimit(config.sync.httpConcurrency);

    const stats: SyncStats = {
      targetsOk: 0,
      targetsFailed: 0,
      failedTargets: [],
      fetched: 0,
      inserted: 0,
      changed: 0,
      unchanged: 0,
      duplicates: 0,
    };

    const targets = this.collectTargets(options.sourceFilter);

    const fetchResults = await Promise.all(
      targets.map(({ source, target }) =>
        limit(async () => {
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
            return rawJobs;
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
            return [];
          }
        }),
      ),
    );

    for (const rawJobs of fetchResults) {
      stats.fetched += rawJobs.length;
      for (const raw of rawJobs) {
        const normalized = normalize(raw);

        if (options.dryRun) {
          const existing = await this.jobsRepository.findExistingByKey(
            normalized.source,
            normalized.board,
            normalized.externalId,
          );
          if (!existing) stats.inserted++;
          else if (existing.contentHash === normalized.contentHash) stats.unchanged++;
          else stats.changed++;
          continue;
        }

        const { job, status } = await this.jobsRepository.upsertJob(normalized);
        if (status === 'unchanged') {
          stats.unchanged++;
          continue;
        }
        if (status === 'changed') {
          stats.changed++;
          continue;
        }

        stats.inserted++;
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
    }

    if (syncRun) {
      await this.jobsRepository.finishSyncRun(syncRun.id, stats);
    }

    return stats;
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
