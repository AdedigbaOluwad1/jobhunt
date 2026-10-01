import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchJson } from '../common/http';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const WorkableJobSchema = z.object({
  title: z.string(),
  shortcode: z.string(),
  employment_type: z.string().nullable().optional(),
  telecommuting: z.boolean().nullable().optional(),
  department: z.string().nullable().optional(),
  url: z.string(),
  application_url: z.string().nullable().optional(),
  published_on: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
});

const WorkableResponseSchema = z.object({
  name: z.string().nullable().optional(),
  jobs: z.array(WorkableJobSchema),
});

type WorkableJob = z.infer<typeof WorkableJobSchema>;

@Injectable()
export class WorkableSource implements JobSource {
  readonly name: SourceName = 'workable';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.workable.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `workable:${target.board}`;
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(target.board)}?details=true`;

    let json: unknown;
    try {
      json = await fetchJson(url, { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries });
    } catch (err) {
      throw fetchFailure(label, err, 'account not found; use the slug from apply.workable.com/<slug>');
    }

    const parsed = WorkableResponseSchema.safeParse(json);
    if (!parsed.success) throw shapeFailure(label, parsed.error);

    const company = config.sources.companyNames?.[target.board] ?? parsed.data.name ?? target.board;
    return parsed.data.jobs.map((job) => this.toRawJob(job, target.board, company));
  }

  private toRawJob(job: WorkableJob, board: string, company: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: job.shortcode,
      company,
      title: job.title,
      location: [job.city, job.country].filter(Boolean).join(', ') || undefined,
      remote: job.telecommuting === true,
      department: job.department ?? undefined,
      employmentType: job.employment_type ?? undefined,
      url: job.url,
      applyUrl: job.application_url ?? job.url,
      descriptionHtml: job.description ?? undefined,
      postedAt: toDate(job.published_on ?? job.created_at),
    };
  }
}
