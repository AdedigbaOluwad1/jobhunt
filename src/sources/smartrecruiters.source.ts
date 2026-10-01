import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchJson } from '../common/http';
import { withLimit } from '../common/limiter';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const PAGE_SIZE = 100;
// The list endpoint omits descriptions, so every posting costs a detail request.
const DETAIL_CONCURRENCY = 4;

const ListItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  releasedDate: z.string().nullable().optional(),
  company: z.object({ name: z.string().nullable().optional() }).nullable().optional(),
  location: z
    .object({ fullLocation: z.string().nullable().optional(), remote: z.boolean().nullable().optional() })
    .nullable()
    .optional(),
  department: z.object({ label: z.string().nullable().optional() }).nullable().optional(),
  typeOfEmployment: z.object({ label: z.string().nullable().optional() }).nullable().optional(),
});

const ListResponseSchema = z.object({
  totalFound: z.number(),
  content: z.array(ListItemSchema),
});

const SectionSchema = z.object({ title: z.string().optional(), text: z.string().optional() });

const DetailResponseSchema = z.object({
  postingUrl: z.string().nullable().optional(),
  applyUrl: z.string().nullable().optional(),
  jobAd: z
    .object({ sections: z.record(z.string(), SectionSchema.nullable()).optional() })
    .nullable()
    .optional(),
});

type ListItem = z.infer<typeof ListItemSchema>;
type Detail = z.infer<typeof DetailResponseSchema>;

@Injectable()
export class SmartRecruitersSource implements JobSource {
  readonly name: SourceName = 'smartrecruiters';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.smartrecruiters.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `smartrecruiters:${target.board}`;
    const base = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(target.board)}/postings`;
    const opts = { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries };

    const items: ListItem[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let json: unknown;
      try {
        json = await fetchJson(`${base}?limit=${PAGE_SIZE}&offset=${offset}`, opts);
      } catch (err) {
        throw fetchFailure(label, err, 'company not found; use the identifier from jobs.smartrecruiters.com/<id>');
      }
      const page = ListResponseSchema.safeParse(json);
      if (!page.success) throw shapeFailure(label, page.error);
      items.push(...page.data.content);
      if (page.data.content.length === 0 || items.length >= page.data.totalFound) break;
    }

    const companyOverride = config.sources.companyNames?.[target.board];
    const limit = withLimit(DETAIL_CONCURRENCY);
    return Promise.all(
      items.map((item) =>
        limit(async () => {
          let json: unknown;
          try {
            json = await fetchJson(`${base}/${encodeURIComponent(item.id)}`, opts);
          } catch (err) {
            throw fetchFailure(`${label}/${item.id}`, err, 'posting not found');
          }
          const detail = DetailResponseSchema.safeParse(json);
          if (!detail.success) throw shapeFailure(`${label}/${item.id}`, detail.error);
          return this.toRawJob(item, detail.data, target, companyOverride);
        }),
      ),
    );
  }

  private toRawJob(item: ListItem, detail: Detail, target: SourceTarget, companyOverride?: string): RawJob {
    const sections = Object.values(detail.jobAd?.sections ?? {});
    const descriptionHtml = sections
      .filter((section) => section?.text)
      .map((section) => `<h3>${section?.title ?? ''}</h3>${section?.text}`)
      .join('\n');
    const url = detail.postingUrl ?? `https://jobs.smartrecruiters.com/${target.board}/${item.id}`;

    return {
      source: this.name,
      board: target.board,
      externalId: item.id,
      company: companyOverride ?? item.company?.name ?? target.board,
      title: item.name,
      location: item.location?.fullLocation ?? undefined,
      remote: item.location?.remote === true,
      department: item.department?.label ?? undefined,
      employmentType: item.typeOfEmployment?.label ?? undefined,
      url,
      applyUrl: detail.applyUrl ?? url,
      descriptionHtml: descriptionHtml || undefined,
      postedAt: toDate(item.releasedDate),
    };
  }
}
