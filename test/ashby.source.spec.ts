import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { AshbySource } from '../src/sources/ashby.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ashby-linear.json'), 'utf8'));

function makeSource(configOverrides = {}) {
  const configService = { load: () => makeTestConfig(configOverrides) } as unknown as ConfigService;
  return new AshbySource(configService);
}

describe('AshbySource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a real Ashby response into RawJob[]', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'ashby', board: 'linear' });

    expect(jobs).toHaveLength(fixture.jobs.length);
    const first = jobs[0];
    expect(first.source).toBe('ashby');
    expect(first.externalId).toBe(fixture.jobs[0].id);
    expect(first.title).toBe(fixture.jobs[0].title);
    expect(first.location).toBe(fixture.jobs[0].location);
    expect(first.url).toBe(fixture.jobs[0].jobUrl);
    expect(first.applyUrl).toBe(fixture.jobs[0].applyUrl);
    expect(first.remote).toBe(true);
    expect(first.descriptionText).toBe(fixture.jobs[0].descriptionPlain);
  });

  it('derives company from the board slug when there is no override', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ jobs: [fixture.jobs[0]] });
    const source = makeSource();

    const [job] = await source.fetch({ source: 'ashby', board: 'linear' });

    expect(job.company).toBe('Linear');
  });

  it('applies a companyNames override', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ jobs: [fixture.jobs[0]] });
    const source = makeSource({
      sources: { greenhouse: [], lever: [], lever_eu: [], ashby: ['linear'], companyNames: { linear: 'Linear, Inc.' } },
    });

    const [job] = await source.fetch({ source: 'ashby', board: 'linear' });

    expect(job.company).toBe('Linear, Inc.');
  });

  it('throws a clear AppError on 404', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'ashby', board: 'does-not-exist' })).rejects.toThrow(AppError);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ notJobs: [] });
    const source = makeSource();

    await expect(source.fetch({ source: 'ashby', board: 'linear' })).rejects.toThrow(/unexpected response shape/);
  });
});
