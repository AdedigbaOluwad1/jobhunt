import { normalize } from '../src/jobs/normalize';
import { RawJob } from '../src/sources/source.interface';

function makeRaw(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'greenhouse',
    board: 'acme',
    externalId: '123',
    company: 'Acme Inc',
    title: 'Backend Engineer',
    location: 'Berlin, Germany',
    url: 'https://boards.greenhouse.io/acme/jobs/123',
    ...overrides,
  };
}

describe('normalize', () => {
  it('produces a stable contentHash for identical input', () => {
    const a = normalize(makeRaw());
    const b = normalize(makeRaw());
    expect(a.contentHash).toBe(b.contentHash);
  });

  it('is case-insensitive for contentHash inputs', () => {
    const lower = normalize(makeRaw({ title: 'backend engineer', company: 'acme inc' }));
    const mixed = normalize(makeRaw({ title: 'Backend Engineer', company: 'Acme Inc' }));
    expect(lower.contentHash).toBe(mixed.contentHash);
  });

  it('changes contentHash when the description changes', () => {
    const a = normalize(makeRaw({ descriptionText: 'Do the thing.' }));
    const b = normalize(makeRaw({ descriptionText: 'Do the other thing.' }));
    expect(a.contentHash).not.toBe(b.contentHash);
  });

  it('builds dedupeKey from slugified company, title, and location', () => {
    const job = normalize(makeRaw());
    expect(job.dedupeKey).toBe('acme-inc|backend-engineer|berlin-germany');
  });

  it('uses "remote" in dedupeKey when the job is remote', () => {
    const job = normalize(makeRaw({ location: 'Remote', remote: true }));
    expect(job.dedupeKey).toBe('acme-inc|backend-engineer|remote');
  });

  it('detects remote from location text even when the source does not flag it', () => {
    const job = normalize(makeRaw({ location: 'Remote - Worldwide', remote: undefined }));
    expect(job.remote).toBe(true);
  });

  it('strips and decodes entity-escaped HTML descriptions', () => {
    const job = normalize(makeRaw({ descriptionText: undefined, descriptionHtml: '&lt;p&gt;Build &amp; ship things&lt;/p&gt;' }));
    expect(job.descriptionText).toBe('Build & ship things');
  });

  it('drops an unparsable postedAt instead of throwing', () => {
    const job = normalize(makeRaw({ postedAt: new Date('not-a-date') }));
    expect(job.postedAt).toBeUndefined();
  });

  it('collapses whitespace in company, title, and location', () => {
    const job = normalize(makeRaw({ company: '  Acme   Inc  ', title: '  Backend   Engineer ', location: '  Berlin,   Germany ' }));
    expect(job.company).toBe('Acme Inc');
    expect(job.title).toBe('Backend Engineer');
    expect(job.location).toBe('Berlin, Germany');
  });
});
