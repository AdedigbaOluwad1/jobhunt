export type SourceName = 'greenhouse' | 'lever' | 'ashby' | 'remotive' | 'remoteok' | 'wwr';

/** Application-tracking-system sources win dedupe ties against remote-board aggregators. */
export const ATS_SOURCES: readonly SourceName[] = ['greenhouse', 'lever', 'ashby'];

export function isAtsSource(source: string): boolean {
  return (ATS_SOURCES as readonly string[]).includes(source);
}

export interface SourceTarget {
  source: SourceName;
  board: string;
  /** Remote-board aggregators set this; SyncService skips the fetch if SourceState.lastFetchedAt is more recent than this. */
  minIntervalHours?: number;
}

export interface RawJob {
  source: SourceName;
  board: string;
  externalId: string;
  company: string;
  title: string;
  location?: string;
  remote?: boolean;
  department?: string;
  employmentType?: string;
  salaryText?: string;
  url: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionText?: string;
  postedAt?: Date;
}

export interface JobSource {
  readonly name: SourceName;
  targets(): SourceTarget[];
  /** Fetch ALL open jobs for one target. Throws on failure; never returns partial data silently. */
  fetch(target: SourceTarget): Promise<RawJob[]>;
}
