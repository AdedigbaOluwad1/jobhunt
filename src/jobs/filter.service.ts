import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

const MS_PER_DAY = 86_400_000;

/** Whatever shape a job comes in as — a fresh NormalizedJob or a stored Job row — filtering only needs these fields. */
export interface FilterableJob {
  title: string;
  location?: string | null;
  remote: boolean;
  descriptionText: string;
  postedAt?: Date | null;
}

export interface FilterResult {
  status: 'passed' | 'rejected';
  reason: string | null;
}

const PASSED: FilterResult = { status: 'passed', reason: null };

function matchesWord(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

/** Deterministic, ordered, cheap filters that run before any LLM call — the first failing rule wins. */
@Injectable()
export class FilterService {
  constructor(private readonly configService: ConfigService) {}

  evaluate(job: FilterableJob): FilterResult {
    const filters = this.configService.load().filters;

    if (job.postedAt) {
      const ageDays = (Date.now() - job.postedAt.getTime()) / MS_PER_DAY;
      if (ageDays > filters.maxAgeDays) {
        return { status: 'rejected', reason: 'max-age' };
      }
    }

    const excludedTitleTerm = filters.titleExclude.find((term) => matchesWord(job.title, term));
    if (excludedTitleTerm) {
      return { status: 'rejected', reason: `title-excluded:${excludedTitleTerm}` };
    }

    if (filters.titleInclude.length > 0 && !filters.titleInclude.some((term) => matchesWord(job.title, term))) {
      return { status: 'rejected', reason: 'title-no-match' };
    }

    if (filters.remoteOnly && !job.remote) {
      return { status: 'rejected', reason: 'not-remote' };
    }

    // locationsAllow only constrains non-remote jobs — a remote job's location text
    // is often just an HQ address and shouldn't disqualify it.
    if (!job.remote && job.location) {
      const locationLower = job.location.toLowerCase();
      const allowed = filters.locationsAllow.some((term) => locationLower.includes(term.toLowerCase()));
      if (!allowed) {
        return { status: 'rejected', reason: `location:${job.location}` };
      }
    }

    const descriptionLower = job.descriptionText.toLowerCase();
    const excludedPhrase = filters.descriptionExclude.find((phrase) => descriptionLower.includes(phrase.toLowerCase()));
    if (excludedPhrase) {
      return { status: 'rejected', reason: `description:${excludedPhrase}` };
    }

    return PASSED;
  }
}
