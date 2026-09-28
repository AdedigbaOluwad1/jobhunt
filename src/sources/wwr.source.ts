import { Injectable } from '@nestjs/common';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchText, HttpError } from '../common/http';
import { ConfigService } from '../config/config.service';
import { titleCaseSlug, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

const WwrItemSchema = z.object({
  title: z.string(),
  region: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  pubDate: z.string().optional(),
  guid: z.string().optional(),
  link: z.string(),
});

const WwrFeedSchema = z.object({
  rss: z.object({
    channel: z.object({
      item: z.union([WwrItemSchema, z.array(WwrItemSchema)]).optional(),
    }),
  }),
});

type WwrItem = z.infer<typeof WwrItemSchema>;

const xmlParser = new XMLParser();

/** Titles are conventionally "Company: Role" — parsed defensively since that's a convention, not a guarantee. */
function parseCompanyAndTitle(rawTitle: string, board: string): { company: string; title: string } {
  const separatorIndex = rawTitle.indexOf(': ');
  if (separatorIndex === -1) {
    return { company: titleCaseSlug(board), title: rawTitle };
  }
  return { company: rawTitle.slice(0, separatorIndex).trim(), title: rawTitle.slice(separatorIndex + 2).trim() };
}

@Injectable()
export class WwrSource implements JobSource {
  readonly name: SourceName = 'wwr';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    const config = this.configService.load().sources.remote?.wwr;
    if (!config?.enabled) return [];
    const feeds = config.feeds?.length ? config.feeds : ['remote-programming-jobs'];
    return feeds.map((feed) => ({ source: this.name, board: feed, minIntervalHours: config.minIntervalHours }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const url = `https://weworkremotely.com/categories/${encodeURIComponent(target.board)}.rss`;

    let xml: string;
    try {
      xml = await fetchText(url, {
        timeoutMs: config.sync.httpTimeoutMs,
        retries: config.sync.httpRetries,
      });
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) {
        throw new AppError('SOURCE_FETCH_FAILED', `wwr:${target.board} — feed not found (404); check the feed name in config.yaml`);
      }
      throw new AppError('SOURCE_FETCH_FAILED', `wwr:${target.board} — ${(err as Error).message}`);
    }

    let doc: unknown;
    try {
      doc = xmlParser.parse(xml);
    } catch (err) {
      throw new AppError('SOURCE_FETCH_FAILED', `wwr:${target.board} — could not parse RSS: ${(err as Error).message}`);
    }

    const parsed = WwrFeedSchema.safeParse(doc);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new AppError(
        'SOURCE_FETCH_FAILED',
        `wwr:${target.board} — unexpected feed shape at ${issue?.path.join('.')}: ${issue?.message}`,
      );
    }

    const item = parsed.data.rss.channel.item;
    const items = item === undefined ? [] : Array.isArray(item) ? item : [item];
    return items.map((entry) => this.toRawJob(entry, target.board));
  }

  private toRawJob(item: WwrItem, board: string): RawJob {
    const { company, title } = parseCompanyAndTitle(item.title, board);
    return {
      source: this.name,
      board,
      externalId: item.guid ?? item.link,
      company,
      title,
      location: item.region,
      remote: true,
      department: item.category,
      // WWR's own listing is the canonical link; the real employer URL isn't reliably discoverable without following redirects.
      url: item.link,
      applyUrl: item.link,
      descriptionHtml: item.description,
      postedAt: toDate(item.pubDate),
    };
  }
}
