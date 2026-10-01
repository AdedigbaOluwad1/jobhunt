import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { fetchText } from '../common/http';
import { withLimit } from '../common/limiter';
import { decodeHtmlEntities } from '../common/text';
import { ConfigService } from '../config/config.service';
import { fetchFailure, shapeFailure, toDate } from './adapter-helpers';
import { JobSource, RawJob, SourceName, SourceTarget } from './source.interface';

// JazzHR has no public JSON API: the listing is server-rendered HTML and each posting page embeds schema.org JobPosting JSON-LD.
const DETAIL_CONCURRENCY = 4;

const LIST_ITEM_PATTERN =
  /<a href="(https:\/\/[a-z0-9-]+\.applytojob\.com\/apply\/([A-Za-z0-9]+)\/[^"]*)">\s*([^<]+?)\s*<\/a>[\s\S]*?fa-map-marker'><\/i>([^<]*)</g;
const DESCRIPTION_PATTERN = /id="job-description">([\s\S]*?)<\/div>/;
const JSON_LD_PATTERN = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;

const JobPostingSchema = z.object({
  '@type': z.literal('JobPosting'),
  title: z.string().optional(),
  description: z.string().optional(),
  datePosted: z.string().optional(),
  employmentType: z.string().optional(),
});

interface ListEntry {
  url: string;
  id: string;
  title: string;
  location: string;
}

function parseList(html: string): ListEntry[] {
  const entries = new Map<string, ListEntry>();
  for (const match of html.matchAll(LIST_ITEM_PATTERN)) {
    const [, url, id, title, location] = match;
    entries.set(id, { url, id, title: decodeHtmlEntities(title), location: decodeHtmlEntities(location).trim() });
  }
  return [...entries.values()];
}

function parseJobPosting(html: string): z.infer<typeof JobPostingSchema> | undefined {
  for (const match of html.matchAll(JSON_LD_PATTERN)) {
    try {
      const parsed = JobPostingSchema.safeParse(JSON.parse(match[1]));
      if (parsed.success) return parsed.data;
    } catch {
      // a malformed JSON-LD block elsewhere on the page shouldn't hide a valid one
    }
  }
  return undefined;
}

@Injectable()
export class JazzHrSource implements JobSource {
  readonly name: SourceName = 'jazzhr';

  constructor(private readonly configService: ConfigService) {}

  targets(): SourceTarget[] {
    return this.configService.load().sources.jazzhr.map((board) => ({ source: this.name, board }));
  }

  async fetch(target: SourceTarget): Promise<RawJob[]> {
    const config = this.configService.load();
    const label = `jazzhr:${target.board}`;
    const opts = { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries };

    let listHtml: string;
    try {
      listHtml = await fetchText(`https://${encodeURIComponent(target.board)}.applytojob.com/apply`, opts);
    } catch (err) {
      throw fetchFailure(label, err, 'careers site not found; use the subdomain of <slug>.applytojob.com');
    }

    const entries = parseList(listHtml);
    if (entries.length === 0 && !/list-group|no (open )?(jobs|positions)/i.test(listHtml)) {
      throw new AppError('SOURCE_FETCH_FAILED', `${label} — unexpected page: no job list found`);
    }

    const company = config.sources.companyNames?.[target.board] ?? target.board;
    const limit = withLimit(DETAIL_CONCURRENCY);
    return Promise.all(
      entries.map((entry) =>
        limit(async () => {
          let detailHtml: string;
          try {
            detailHtml = await fetchText(entry.url, opts);
          } catch (err) {
            throw fetchFailure(`${label}/${entry.id}`, err, 'posting not found');
          }
          // Some postings (e.g. ones without a posted date) omit the JobPosting JSON-LD but still render the description.
          const posting = parseJobPosting(detailHtml) ?? { description: DESCRIPTION_PATTERN.exec(detailHtml)?.[1] };
          if (!posting.description) {
            throw shapeFailure(
              `${label}/${entry.id}`,
              new z.ZodError([{ code: 'custom', path: ['description'], message: 'no job description found', input: undefined }]),
            );
          }
          return this.toRawJob(entry, posting, target.board, company);
        }),
      ),
    );
  }

  private toRawJob(entry: ListEntry, posting: Partial<z.infer<typeof JobPostingSchema>>, board: string, company: string): RawJob {
    return {
      source: this.name,
      board,
      externalId: entry.id,
      company,
      title: posting.title ?? entry.title,
      location: entry.location || undefined,
      employmentType: posting.employmentType,
      url: entry.url,
      applyUrl: entry.url,
      descriptionHtml: posting.description,
      postedAt: toDate(posting.datePosted),
    };
  }
}
