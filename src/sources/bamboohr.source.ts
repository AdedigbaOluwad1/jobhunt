import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchJson } from '../common/http';
import { withLimit } from '../common/limiter';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const LocationSchema = z
  .object({
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    addressCountry: z.string().nullable().optional(),
  })
  .nullable()
  .optional();

const ListItemSchema = z.object({
  id: z.string(),
  jobOpeningName: z.string(),
  departmentLabel: z.string().nullable().optional(),
  employmentStatusLabel: z.string().nullable().optional(),
  location: LocationSchema,
  isRemote: z.boolean().nullable().optional(),
});

const ListResponseSchema = z.object({ result: z.array(ListItemSchema) });

const DetailResponseSchema = z.object({
  result: z.object({
    jobOpening: z.object({
      jobOpeningShareUrl: z.string().nullable().optional(),
      description: z.string().nullable().optional(),
      datePosted: z.string().nullable().optional(),
      compensation: z.string().nullable().optional(),
      location: LocationSchema,
    }),
  }),
});

type ListItem = z.infer<typeof ListItemSchema>;

const JSON_HEADERS = { Accept: 'application/json' };
// BambooHR's list endpoint omits descriptions, so every opening costs a detail request.
const DETAIL_CONCURRENCY = 4;

@Injectable()
export class BambooHrSource implements JobSource {
  readonly name: SourceName = 'bamboohr';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.bamboohr.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `bamboohr:${target.board}`;
    const base = `https://${encodeURIComponent(target.board)}.bamboohr.com/careers`;
    const opts = { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries, headers: JSON_HEADERS };

    let listJson: unknown;
    try {
      listJson = await fetchJson(`${base}/list`, opts);
    } catch (err) {
      throw fetchFailure(label, err, 'careers site not found; use the subdomain of <slug>.bamboohr.com');
    }
    const list = ListResponseSchema.safeParse(listJson);
    if (!list.success) throw shapeFailure(label, list.error);

    const companyOverride = config.sources.companyNames?.[target.board] ?? target.board;
    const limit = withLimit(DETAIL_CONCURRENCY);
    return Promise.all(
      list.data.result.map((item) =>
        limit(async () => {
          let detailJson: unknown;
          try {
            detailJson = await fetchJson(`${base}/${encodeURIComponent(item.id)}/detail`, opts);
          } catch (err) {
            throw fetchFailure(`${label}/${item.id}`, err, 'opening not found');
          }
          const detail = DetailResponseSchema.safeParse(detailJson);
          if (!detail.success) throw shapeFailure(`${label}/${item.id}`, detail.error);
          return this.toRawJob(item, detail.data.result.jobOpening, target.board, companyOverride, base);
        }),
      ),
    );
  }

  private toRawJob(
    item: ListItem,
    detail: z.infer<typeof DetailResponseSchema>['result']['jobOpening'],
    board: string,
    company: string,
    base: string,
  ): RawJob {
    const location = detail.location ?? item.location;
    const url = detail.jobOpeningShareUrl ?? `${base}/${item.id}`;
    return {
      source: this.name,
      board,
      externalId: item.id,
      company,
      title: item.jobOpeningName,
      location: [location?.city, location?.state, location?.addressCountry].filter(Boolean).join(', ') || undefined,
      remote: item.isRemote === true,
      department: item.departmentLabel ?? undefined,
      employmentType: item.employmentStatusLabel ?? undefined,
      salaryText: detail.compensation ?? undefined,
      url,
      applyUrl: url,
      descriptionHtml: detail.description ?? undefined,
      postedAt: toDate(detail.datePosted),
    };
  }
}
