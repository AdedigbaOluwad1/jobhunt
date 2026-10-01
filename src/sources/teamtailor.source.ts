import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchText } from '../common/http';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const LocationSchema = z.object({
  'tt:city': z.union([z.string(), z.number()]).optional(),
  'tt:country': z.string().optional(),
});

const ItemSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  pubDate: z.string().optional(),
  link: z.string(),
  guid: z.string().optional(),
  remoteStatus: z.string().optional(),
  'tt:locations': z
    .object({ 'tt:location': z.union([LocationSchema, z.array(LocationSchema)]).optional() })
    .optional(),
  'tt:department': z.string().optional(),
});

const FeedSchema = z.object({
  rss: z.object({
    channel: z.object({
      title: z.string().optional(),
      item: z.union([ItemSchema, z.array(ItemSchema)]).optional(),
    }),
  }),
});

type Item = z.infer<typeof ItemSchema>;

const xmlParser = new XMLParser({ processEntities: true });

/**
 * `board` is the careers-site host, e.g. "careers.paystack.com" or "acme.teamtailor.com".
 * Teamtailor has no public company slug API, but every careers site serves /jobs.rss.
 */
@Injectable()
export class TeamtailorSource implements JobSource {
  readonly name: SourceName = 'teamtailor';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.teamtailor.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `teamtailor:${target.board}`;

    let xml: string;
    try {
      xml = await fetchText(`https://${target.board}/jobs.rss`, {
        timeoutMs: config.sync.httpTimeoutMs,
        retries: config.sync.httpRetries,
      });
    } catch (err) {
      throw fetchFailure(label, err, 'careers site not found; use its hostname, e.g. careers.example.com');
    }

    let doc: unknown;
    try {
      doc = xmlParser.parse(xml);
    } catch (err) {
      throw new AppError('SOURCE_FETCH_FAILED', `${label} — could not parse RSS: ${(err as Error).message}`);
    }

    const parsed = FeedSchema.safeParse(doc);
    if (!parsed.success) throw shapeFailure(label, parsed.error);

    const company = config.sources.companyNames?.[target.board] ?? parsed.data.rss.channel.title ?? target.board;
    const item = parsed.data.rss.channel.item;
    const items = item === undefined ? [] : Array.isArray(item) ? item : [item];
    return items.map((entry) => this.toRawJob(entry, target.board, company));
  }

  private toRawJob(item: Item, board: string, company: string): RawJob {
    const rawLocations = item['tt:locations']?.['tt:location'];
    const locations = rawLocations === undefined ? [] : Array.isArray(rawLocations) ? rawLocations : [rawLocations];
    const location = locations
      .map((loc) => [loc['tt:city'], loc['tt:country']].filter(Boolean).join(', '))
      .filter(Boolean)
      .join(' / ');

    return {
      source: this.name,
      board,
      externalId: item.guid ?? item.link,
      company,
      title: item.title,
      location: location || undefined,
      remote: item.remoteStatus === 'fully',
      department: item['tt:department'],
      url: item.link,
      applyUrl: item.link,
      descriptionHtml: item.description,
      postedAt: toDate(item.pubDate),
    };
  }
}
