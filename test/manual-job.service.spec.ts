import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { JobsRepository } from '../src/db/jobs.repository';
import { ManualJobService } from '../src/jobs/manual-job.service';
import { makeTestConfig } from './helpers/fake-config';

const LONG_DESCRIPTION = 'Build and operate payment systems in TypeScript. '.repeat(10);

function jobPostingHtml(overrides: Record<string, unknown> = {}): string {
  return `<script type="application/ld+json">${JSON.stringify({
    '@type': 'JobPosting',
    title: 'Backend Engineer',
    description: `<p>${LONG_DESCRIPTION}</p>`,
    hiringOrganization: { name: 'Interswitch' },
    jobLocation: { address: { addressLocality: 'Lagos', addressCountry: 'Nigeria' } },
    datePosted: '2026-09-20',
    ...overrides,
  })}</script>`;
}

function makeService(duplicate: { id: number; source: string } | null = null) {
  const upsertJob = jest.fn(async (job, filter) => ({ job: { id: 7, ...job, filterStatus: filter.status }, status: 'inserted' as const }));
  const findDuplicateCandidate = jest.fn(async () => duplicate);
  const repository = { upsertJob, findDuplicateCandidate } as unknown as JobsRepository;
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return { service: new ManualJobService(configService, repository), upsertJob, findDuplicateCandidate };
}

describe('ManualJobService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('fetches the page, reads its JobPosting, and stores it as a manual job that bypasses the filters', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(jobPostingHtml());
    const { service, upsertJob } = makeService();

    const result = await service.add({ url: 'https://careers.interswitchgroup.com/jobs/42/?utm_source=linkedin#top' });

    expect(result.status).toBe('inserted');
    const [normalized, filter] = upsertJob.mock.calls[0];
    expect(normalized).toMatchObject({
      source: 'manual',
      board: 'manual',
      externalId: 'https://careers.interswitchgroup.com/jobs/42',
      company: 'Interswitch',
      title: 'Backend Engineer',
      location: 'Lagos, Nigeria',
    });
    expect(normalized.descriptionText).toContain('payment systems');
    expect(filter).toEqual({ status: 'passed', reason: null });
  });

  it('lets explicit options override what the page says', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(jobPostingHtml());
    const { service, upsertJob } = makeService();

    await service.add({ url: 'https://example.com/j/1', company: 'Interswitch Group', title: 'Senior Backend Engineer', remote: true });

    expect(upsertJob.mock.calls[0][0]).toMatchObject({
      company: 'Interswitch Group',
      title: 'Senior Backend Engineer',
      remote: true,
    });
  });

  it('uses a pasted description without fetching, even for LinkedIn', async () => {
    const fetchText = jest.spyOn(http, 'fetchText');
    const { service, upsertJob } = makeService();

    await service.add({
      url: 'https://www.linkedin.com/jobs/view/12345',
      company: 'OPay',
      title: 'DevOps Engineer',
      description: 'Run our infrastructure.',
    });

    expect(fetchText).not.toHaveBeenCalled();
    expect(upsertJob.mock.calls[0][0]).toMatchObject({ company: 'OPay', descriptionText: 'Run our infrastructure.' });
  });

  it('refuses to fetch LinkedIn and explains how to paste instead', async () => {
    const fetchText = jest.spyOn(http, 'fetchText');
    const { service } = makeService();

    await expect(service.add({ url: 'https://ng.linkedin.com/jobs/view/12345' })).rejects.toThrow(/--description-file/);
    expect(fetchText).not.toHaveBeenCalled();
  });

  it('asks for --company and --title when the page does not state them', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(`<main>${LONG_DESCRIPTION}</main>`);
    const { service } = makeService();

    await expect(service.add({ url: 'https://example.com/j/1' })).rejects.toThrow(/--company and --title/);
  });

  it('rejects a page with no real description, pointing at --description-file', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue('<html><body><div id="root"></div></body></html>');
    const { service } = makeService();

    await expect(service.add({ url: 'https://example.com/j/1', company: 'X', title: 'Y' })).rejects.toThrow(/JavaScript/);
  });

  it('wraps fetch failures with the paste hint', async () => {
    jest.spyOn(http, 'fetchText').mockRejectedValue(new http.HttpError(403, 'https://example.com/j/1'));
    const { service } = makeService();

    const failure = service.add({ url: 'https://example.com/j/1' });
    await expect(failure).rejects.toThrow(AppError);
    await expect(failure).rejects.toThrow(/403.*--description-file/);
  });

  it('rejects a bad URL before doing anything else', async () => {
    const { service, upsertJob } = makeService();

    await expect(service.add({ url: 'not a url' })).rejects.toThrow(/not a valid URL/);
    expect(upsertJob).not.toHaveBeenCalled();
  });

  it('reports a similar job from another source without blocking the add', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(jobPostingHtml());
    const { service } = makeService({ id: 3, source: 'greenhouse' });

    const result = await service.add({ url: 'https://example.com/j/1' });

    expect(result.similarJob).toEqual({ id: 3, source: 'greenhouse' });
  });
});
