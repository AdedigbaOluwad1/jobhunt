import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { GreenhouseSource } from '../src/sources/greenhouse.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'greenhouse-stripe.json'), 'utf8'),
);

function makeSource(configOverrides = {}): GreenhouseSource {
  const configService = { load: () => makeTestConfig(configOverrides) } as unknown as ConfigService;
  return new GreenhouseSource(configService);
}

describe('GreenhouseSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a real Greenhouse response into RawJob[]', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'greenhouse', board: 'stripe' });

    expect(jobs).toHaveLength(fixture.jobs.length);
    const first = jobs[0];
    expect(first.source).toBe('greenhouse');
    expect(first.board).toBe('stripe');
    expect(first.externalId).toBe(String(fixture.jobs[0].id));
    expect(first.company).toBe(fixture.jobs[0].company_name);
    expect(first.title).toBe(fixture.jobs[0].title);
    expect(first.url).toBe(fixture.jobs[0].absolute_url);
    expect(first.applyUrl).toBe(fixture.jobs[0].absolute_url);
    expect(first.descriptionHtml).toBe(fixture.jobs[0].content);
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('tolerates a job with no location and applies a companyNames override', async () => {
    const noLocation = { jobs: [{ ...fixture.jobs[0], location: null, company_name: undefined }] };
    jest.spyOn(http, 'fetchJson').mockResolvedValue(noLocation);
    const source = makeSource({
      sources: { greenhouse: ['stripe'], lever: [], lever_eu: [], ashby: [], companyNames: { stripe: 'Stripe, Inc.' } },
    });

    const [job] = await source.fetch({ source: 'greenhouse', board: 'stripe' });

    expect(job.location).toBeUndefined();
    expect(job.company).toBe('Stripe, Inc.');
  });

  it('throws a clear AppError on 404 (bad board slug)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'greenhouse', board: 'does-not-exist' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'greenhouse', board: 'does-not-exist' })).rejects.toThrow(/not found/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ notJobs: [] });
    const source = makeSource();

    await expect(source.fetch({ source: 'greenhouse', board: 'stripe' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'greenhouse', board: 'stripe' })).rejects.toThrow(/unexpected response shape/);
  });
});
