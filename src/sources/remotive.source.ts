import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchJson, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const RemotiveJobSchema = z.object({
  id: z.number(),
  url: z.string(),
  title: z.string(),
  company_name: z.string(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  job_type: z.string().optional(),
  publication_date: z.string().optional(),
  candidate_required_location: z.string().optional(),
  salary: z.string().optional(),
  description: z.string().optional(),
});

const RemotiveResponseSchema = z.object({
  jobs: z.array(RemotiveJobSchema),
});

type RemotiveJob = z.infer<typeof RemotiveJobSchema>;

/**
 * Remotive's terms ask for no more than ~4 requests/day and require linking
 * back to their own listing page (never the underlying employer) — see
 * config.sources.remote.remotive.minIntervalHours, enforced by SyncService.
 */
@Injectable()
export class RemotiveSource implements JobSource {
  readonly name: SourceName = 'remotive';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load().sources.remote?.remotive;
    if (!config?.enabled) return [];
    const categories = config.categories?.length ? config.categories : ['software-dev'];
    return categories.map((category) => ({ source: this.name, board: category, minIntervalHours: config.minIntervalHours }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const url = `https://remotive.com/api/remote-jobs?category=${encodeURIComponent(target.board)}`;

    let json: unknown;
    try {
      json = await fetchJson(url, {
        timeoutMs: config.sync.httpTimeoutMs,
        retries: config.sync.httpRetries,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new AppError('SOURCE_FETCH_FAILED', `remotive:${target.board} — category not found (404); check config.yaml`);
      }
      throw new AppError('SOURCE_FETCH_FAILED', `remotive:${target.board} — ${(err as Error).message}`);
    }

    const parsed = RemotiveResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'SOURCE_FETCH_FAILED',
        `remotive:${target.board} — unexpected response shape at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }

    return parsed.data.jobs.map((job) => this.toRawJob(job, target.board));
  }

  private toRawJob(job: RemotiveJob, board: string): RawJob {
    const location = job.candidate_required_location;
    return {
      source: this.name,
      board,
      externalId: String(job.id),
      company: job.company_name,
      title: job.title,
      location,
      remote: true,
      department: job.category,
      employmentType: job.job_type,
      salaryText: job.salary || undefined,
      url: job.url,
      applyUrl: job.url,
      descriptionHtml: job.description,
      postedAt: toDate(job.publication_date),
    };
  }
}
