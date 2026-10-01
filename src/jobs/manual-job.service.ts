import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { fetchText } from '../common/http';
import { ConfigService } from '../config/config.service';
import { JobsRepository } from '../db/jobs.repository';
import type { Job } from '../generated/prisma/client';
import { RawJob } from '../sources/source.interface';
import { canonicalizeUrl, ParsedJobPage, parseJobPage } from './job-page';
import { normalize } from './normalize';

export const MANUAL_SOURCE = 'manual';

/** Below this, a fetched page is almost certainly a JS shell or login wall rather than a posting. */
const MIN_FETCHED_DESCRIPTION_CHARS = 200;

export interface AddJobInput {
  url: string;
  company?: string;
  title?: string;
  location?: string;
  remote?: boolean;
  /** Pasted description; skips fetching the page entirely. */
  description?: string;
}

export interface AddJobResult {
  job: Job;
  status: 'inserted' | 'changed' | 'unchanged';
  similarJob?: { id: number; source: string };
}

const PASTE_HINT = 'pass the description yourself with --description-file <file> ("-" reads stdin)';

@Injectable()
export class ManualJobService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jobsRepository: JobsRepository,
  ) {}

  async add(input: AddJobInput): Promise<AddJobResult> {
    const url = this.parseUrl(input.url);
    const parsed = input.description === undefined ? await this.fetchAndParse(url) : {};

    const company = input.company ?? parsed.company;
    const title = input.title ?? parsed.title;
    const missing = [company ? null : '--company', title ? null : '--title'].filter(Boolean);
    if (missing.length > 0) {
      throw new AppError('INVALID_ARGUMENT', `couldn't work out the job's details from the page; provide ${missing.join(' and ')}`);
    }

    const raw: RawJob = {
      source: MANUAL_SOURCE,
      board: MANUAL_SOURCE,
      externalId: url.href,
      company: company!,
      title: title!,
      location: input.location ?? parsed.location,
      remote: input.remote ?? parsed.remote,
      employmentType: parsed.employmentType,
      url: url.href,
      applyUrl: url.href,
      descriptionText: input.description ?? parsed.descriptionText,
      descriptionHtml: parsed.descriptionHtml,
      postedAt: parsed.postedAt,
    };

    const normalized = normalize(raw);
    // An explicitly added job is wanted regardless of the sync filters.
    const { job, status } = await this.jobsRepository.upsertJob(normalized, { status: 'passed', reason: null });

    const similarJob =
      status === 'inserted'
        ? ((await this.jobsRepository.findDuplicateCandidate(job.dedupeKey, MANUAL_SOURCE, MANUAL_SOURCE)) ?? undefined)
        : undefined;
    return { job, status, similarJob };
  }

  private parseUrl(raw: string): URL {
    try {
      return canonicalizeUrl(raw);
    } catch (err) {
      throw new AppError('INVALID_ARGUMENT', (err as Error).message);
    }
  }

  private async fetchAndParse(url: URL): Promise<ParsedJobPage> {
    if (/(^|\.)linkedin\.com$/i.test(url.hostname)) {
      throw new AppError(
        'INVALID_ARGUMENT',
        `LinkedIn pages can't be fetched automatically (login wall); copy the job description from the page and ${PASTE_HINT}, plus --company and --title`,
      );
    }

    const config = this.configService.load();
    let html: string;
    try {
      html = await fetchText(url.href, { timeoutMs: config.sync.httpTimeoutMs, retries: config.sync.httpRetries });
    } catch (err) {
      throw new AppError('SOURCE_FETCH_FAILED', `couldn't fetch ${url.href} (${(err as Error).message}); ${PASTE_HINT}`);
    }

    const parsed = parseJobPage(html);
    const length = (parsed.descriptionHtml ?? parsed.descriptionText ?? '').length;
    if (length < MIN_FETCHED_DESCRIPTION_CHARS) {
      throw new AppError('SOURCE_FETCH_FAILED', `no job description found at ${url.href} (the page may load it with JavaScript); ${PASTE_HINT}`);
    }
    return parsed;
  }
}
