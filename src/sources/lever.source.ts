import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchJson, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { titleCaseSlug, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const LeverJobSchema = z.object({
  id: z.string(),
  text: z.string(),
  categories: z
    .object({
      location: z.string().optional(),
      commitment: z.string().optional(),
      team: z.string().optional(),
      department: z.string().optional(),
    })
    .optional(),
  workplaceType: z.string().optional(),
  createdAt: z.number().optional(),
  descriptionPlain: z.string().optional(),
  description: z.string().optional(),
  hostedUrl: z.string(),
  applyUrl: z.string().optional(),
});

const LeverResponseSchema = z.array(LeverJobSchema);

type LeverJob = z.infer<typeof LeverJobSchema>;

@Injectable()
export class LeverSource implements JobSource {
  readonly name: SourceName = 'lever';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load();
    return [...config.sources.lever, ...config.sources.lever_eu].map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const host = config.sources.lever_eu.includes(target.board) ? 'api.eu.lever.co' : 'api.lever.co';
    const url = `https://${host}/v0/postings/${encodeURIComponent(target.board)}?mode=json`;

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
          `lever:${target.board} — board not found (404); check the slug in config.yaml`,
        );
      }
      throw new AppError('SOURCE_FETCH_FAILED', `lever:${target.board} — ${(err as Error).message}`);
    }

    const parsed = LeverResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'SOURCE_FETCH_FAILED',
        `lever:${target.board} — unexpected response shape at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }

    const companyOverride = config.sources.companyNames?.[target.board];
    return parsed.data.map((job) => this.toRawJob(job, target.board, companyOverride));
  }

  private toRawJob(job: LeverJob, board: string, companyOverride?: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: job.id,
      company: companyOverride ?? titleCaseSlug(board),
      title: job.text,
      location: job.categories?.location,
      remote: job.workplaceType === 'remote',
      department: job.categories?.team ?? job.categories?.department,
      employmentType: job.categories?.commitment,
      url: job.hostedUrl,
      applyUrl: job.applyUrl ?? job.hostedUrl,
      descriptionText: job.descriptionPlain,
      descriptionHtml: job.descriptionPlain ? undefined : job.description,
      postedAt: toDate(job.createdAt),
    };
  }
}
