import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchJson, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { titleCaseSlug, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const GreenhouseJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.string(),
  location: z
    .object({ name: z.string().nullable().optional() })
    .nullable()
    .optional(),
  content: z.string().nullable().optional(),
  company_name: z.string().optional(),
  departments: z.array(z.object({ name: z.string() })).optional(),
  first_published: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});

const GreenhouseResponseSchema = z.object({
  jobs: z.array(GreenhouseJobSchema),
});

type GreenhouseJob = z.infer<typeof GreenhouseJobSchema>;

@Injectable()
export class GreenhouseSource implements JobSource {
  readonly name: SourceName = 'greenhouse';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load();
    return config.sources.greenhouse.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(target.board)}/jobs?content=true`;

    let json: unknown;
    try {
      json = await fetchJson(url, {
        timeoutMs: config.sync.httpTimeoutMs,
        retries: config.sync.httpRetries,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new AppError(
          'SOURCE_FETCH_FAILED',
          `greenhouse:${target.board} — board not found (404); check the slug in config.yaml`,
        );
      }
      throw new AppError('SOURCE_FETCH_FAILED', `greenhouse:${target.board} — ${(err as Error).message}`);
    }

    const parsed = GreenhouseResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'SOURCE_FETCH_FAILED',
        `greenhouse:${target.board} — unexpected response shape at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }

    const companyOverride = config.sources.companyNames?.[target.board];
    return parsed.data.jobs.map((job) => this.toRawJob(job, target.board, companyOverride));
  }

  private toRawJob(job: GreenhouseJob, board: string, companyOverride?: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: String(job.id),
      company: companyOverride ?? job.company_name ?? titleCaseSlug(board),
      title: job.title,
      location: job.location?.name ?? undefined,
      department: job.departments?.[0]?.name,
      url: job.absolute_url,
      applyUrl: job.absolute_url,
      descriptionHtml: job.content ?? undefined,
      postedAt: toDate(job.first_published ?? job.updated_at),
    };
  }
}
