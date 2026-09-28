import { sha256 } from '../common/hash';
import { collapseWhitespace, slugify, stripHtml } from '../common/text';
import { RawJob, SourceName } from '../sources/source.interface';

const MAX_DESCRIPTION_LENGTH = 50_000;
const REMOTE_PATTERN = /\bremote\b|\banywhere\b|\bworldwide\b/i;

export interface NormalizedJob {
  source: SourceName;
  board: string;
  externalId: string;
  company: string;
  title: string;
  location?: string;
  remote: boolean;
  department?: string;
  employmentType?: string;
  salaryText?: string;
  url: string;
  applyUrl?: string;
  descriptionText: string;
  postedAt?: Date;
  contentHash: string;
  dedupeKey: string;
}

export function normalize(raw: RawJob): NormalizedJob {
  const company = collapseWhitespace(raw.company);
  const title = collapseWhitespace(raw.title);
  const location = raw.location ? collapseWhitespace(raw.location) : undefined;
  const descriptionText = normalizeDescription(raw);
  const remote = raw.remote === true || REMOTE_PATTERN.test(location ?? '');
  const postedAt = raw.postedAt && !Number.isNaN(raw.postedAt.getTime()) ? raw.postedAt : undefined;

  const contentHash = sha256(
    [title.toLowerCase(), company.toLowerCase(), (location ?? '').toLowerCase(), descriptionText].join('|'),
  );
  const dedupeKey = [slugify(company), slugify(title), remote ? 'remote' : slugify(location ?? '')].join('|');

  return {
    source: raw.source,
    board: raw.board,
    externalId: raw.externalId,
    company,
    title,
    location,
    remote,
    department: raw.department,
    employmentType: raw.employmentType,
    salaryText: raw.salaryText,
    url: raw.url,
    applyUrl: raw.applyUrl,
    descriptionText,
    postedAt,
    contentHash,
    dedupeKey,
  };
}

function normalizeDescription(raw: RawJob): string {
  const text = raw.descriptionText ?? (raw.descriptionHtml ? stripHtml(raw.descriptionHtml) : '');
  return collapseWhitespace(text).slice(0, MAX_DESCRIPTION_LENGTH);
}
