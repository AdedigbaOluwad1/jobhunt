import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchJson, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { titleCaseSlug, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const AshbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  department: z.string().optional(),
  team: z.string().optional(),
  employmentType: z.string().optional(),
  location: z.string().optional(),
  publishedAt: z.string().optional(),
  isRemote: z.boolean().optional(),
  workplaceType: z.string().optional(),
  jobUrl: z.string(),
  applyUrl: z.string().optional(),
  descriptionHtml: z.string().optional(),
  descriptionPlain: z.string().optional(),
});

const AshbyResponseSchema = z.object({
  jobs: z.array(AshbyJobSchema),
});

type AshbyJob = z.infer<typeof AshbyJobSchema>;

@Injectable()
export class AshbySource implements JobSource {
  readonly name: SourceName = 'ashby';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load();
    return config.sources.ashby.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(target.board)}?includeCompensation=true`;

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
          `ashby:${target.board} — board not found (404); check the slug in config.yaml`,
        );
      }
      throw new AppError('SOURCE_FETCH_FAILED', `ashby:${target.board} — ${(err as Error).message}`);
    }

    const parsed = AshbyResponseSchema.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'SOURCE_FETCH_FAILED',
        `ashby:${target.board} — unexpected response shape at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }

    const companyOverride = config.sources.companyNames?.[target.board];
    return parsed.data.jobs.map((job) => this.toRawJob(job, target.board, companyOverride));
  }

  private toRawJob(job: AshbyJob, board: string, companyOverride?: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: job.id,
      company: companyOverride ?? titleCaseSlug(board),
      title: job.title,
      location: job.location,
      remote: job.isRemote === true || job.workplaceType?.toLowerCase() === 'remote',
      department: job.team ?? job.department,
      employmentType: job.employmentType,
      url: job.jobUrl,
      applyUrl: job.applyUrl ?? job.jobUrl,
      descriptionText: job.descriptionPlain,
      descriptionHtml: job.descriptionPlain ? undefined : job.descriptionHtml,
      postedAt: toDate(job.publishedAt),
    };
  }
}
