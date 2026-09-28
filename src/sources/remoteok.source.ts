import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchJson, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const RemoteOkJobSchema = z.object({
  id: z.union([z.string(), z.number()]),
  slug: z.string().optional(),
  company: z.string(),
  position: z.string(),
  location: z.string().optional(),
  tags: z.array(z.string()).optional(),
  description: z.string().optional(),
  date: z.string().optional(),
  url: z.string(),
  apply_url: z.string().optional(),
  salary_min: z.number().optional(),
  salary_max: z.number().optional(),
});

// RemoteOK's first array element is a legal/attribution notice, not a job.
const RemoteOkResponseSchema = z.array(z.unknown()).min(1);

type RemoteOkJob = z.infer<typeof RemoteOkJobSchema>;

/** RemoteOK's terms require linking back to their own listing and crediting them as the source. */
@Injectable()
export class RemoteOkSource implements JobSource {
  readonly name: SourceName = 'remoteok';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load().sources.remote?.remoteok;
    if (!config?.enabled) return [];
    return [{ source: this.name, board: 'all', minIntervalHours: config.minIntervalHours }];
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const url = 'https://remoteok.com/api';

    let json: unknown;
    try {
      json = await fetchJson(url, {
        timeoutMs: config.sync.httpTimeoutMs,
        retries: config.sync.httpRetries,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new AppError('SOURCE_FETCH_FAILED', `remoteok:${target.board} — endpoint not found (404)`);
      }
      throw new AppError('SOURCE_FETCH_FAILED', `remoteok:${target.board} — ${(err as Error).message}`);
    }

    const parsed = RemoteOkResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new AppError('SOURCE_FETCH_FAILED', `remoteok:${target.board} — unexpected response shape: expected a non-empty array`);
    }

    const jobs: RawJob[] = [];
    // element 0 is a legal notice object, not a job — skip it.
    for (const entry of parsed.data.slice(1)) {
      const job = RemoteOkJobSchema.safeParse(entry);
      if (!job.success) {
        throw new AppError(
          'SOURCE_FETCH_FAILED',
          `remoteok:${target.board} — unexpected job shape at index ${jobs.length + 1}: ${job.error.issues[0]?.message}`,
        );
      }
      jobs.push(this.toRawJob(job.data, target.board));
    }
    return jobs;
  }

  private toRawJob(job: RemoteOkJob, board: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: String(job.id),
      company: job.company,
      title: job.position,
      location: job.location,
      remote: true,
      salaryText: job.salary_min && job.salary_max ? `$${job.salary_min}–$${job.salary_max}` : undefined,
      // RemoteOK's terms require linking back to their own listing, not the employer's.
      url: job.url,
      applyUrl: job.apply_url ?? job.url,
      descriptionHtml: job.description,
      postedAt: toDate(job.date),
    };
  }
}
