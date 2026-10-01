import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { fetchJson } from '../common/http';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const RecruiteeOfferSchema = z.object({
  id: z.number(),
  title: z.string(),
  company_name: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  remote: z.boolean().nullable().optional(),
  department: z.string().nullable().optional(),
  employment_type_code: z.string().nullable().optional(),
  careers_url: z.string(),
  careers_apply_url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  requirements: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
});

const RecruiteeResponseSchema = z.object({ offers: z.array(RecruiteeOfferSchema) });

type RecruiteeOffer = z.infer<typeof RecruiteeOfferSchema>;

@Injectable()
export class RecruiteeSource implements JobSource {
  readonly name: SourceName = 'recruitee';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.recruitee.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `recruitee:${target.board}`;
    const url = `https://${encodeURIComponent(target.board)}.recruitee.com/api/offers/`;

    let json: unknown;
    try {
      json = await fetchJson(url, { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries });
    } catch (err) {
      throw fetchFailure(label, err, 'careers site not found; use the subdomain of <slug>.recruitee.com');
    }

    const parsed = RecruiteeResponseSchema.safeParse(json);
    if (!parsed.success) throw shapeFailure(label, parsed.error);

    const companyOverride = config.sources.companyNames?.[target.board];
    return parsed.data.offers.map((offer) => this.toRawJob(offer, target.board, companyOverride));
  }

  private toRawJob(offer: RecruiteeOffer, board: string, companyOverride?: string): RawJob {
    const description = [offer.description, offer.requirements].filter(Boolean).join('\n');
    return {
      source: this.name,
      board,
      externalId: String(offer.id),
      company: companyOverride ?? offer.company_name ?? board,
      title: offer.title,
      location: offer.location ?? undefined,
      remote: offer.remote === true,
      department: offer.department ?? undefined,
      employmentType: offer.employment_type_code ?? undefined,
      url: offer.careers_url,
      applyUrl: offer.careers_apply_url ?? offer.careers_url,
      descriptionHtml: description || undefined,
      postedAt: toDate(offer.published_at ?? offer.created_at),
    };
  }
}
