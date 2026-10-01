import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchJson } from '../common/http';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const BreezyJobSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  published_date: z.string().nullable().optional(),
  type: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  location: z
    .object({ name: z.string().nullable().optional(), is_remote: z.boolean().nullable().optional() })
    .nullable()
    .optional(),
  department: z.string().nullable().optional(),
  salary: z.string().nullable().optional(),
  company: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  description: z.string().nullable().optional(),
});

const BreezyResponseSchema = z.array(BreezyJobSchema);

type BreezyJob = z.infer<typeof BreezyJobSchema>;

@Injectable()
export class BreezySource implements JobSource {
  readonly name: SourceName = 'breezy';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.breezy.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `breezy:${target.board}`;
    const url = `https://${encodeURIComponent(target.board)}.breezy.hr/json`;

    let json: unknown;
    try {
      json = await fetchJson(url, { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries });
    } catch (err) {
      throw fetchFailure(label, err, 'careers site not found; use the subdomain of <slug>.breezy.hr');
    }

    const parsed = BreezyResponseSchema.safeParse(json);
    if (!parsed.success) throw shapeFailure(label, parsed.error);

    const companyOverride = config.sources.companyNames?.[target.board];
    return parsed.data.map((job) => this.toRawJob(job, target.board, companyOverride));
  }

  private toRawJob(job: BreezyJob, board: string, companyOverride?: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: job.id,
      company: companyOverride ?? job.company?.name ?? board,
      title: job.name,
      location: job.location?.name ?? undefined,
      remote: job.location?.is_remote === true,
      department: job.department ?? undefined,
      employmentType: job.type?.name ?? undefined,
      salaryText: job.salary ?? undefined,
      url: job.url,
      applyUrl: job.url,
      descriptionHtml: job.description ?? undefined,
      postedAt: toDate(job.published_date),
    };
  }
}
