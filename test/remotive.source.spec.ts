import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { RemotiveSource } from '../src/sources/remotive.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'remotive.json'), 'utf8'));

function makeSource(remoteOverrides: Record<string, unknown> = {}) {
  const configService = {
    load: () =>
      makeTestConfig({
        sources: {
          greenhouse: [],
          lever: [],
          lever_eu: [],
          ashby: [],
          remote: { remotive: { enabled: true, categories: ['software-dev'], minIntervalHours: 12 }, ...remoteOverrides },
        },
      }),
  } as unknown as ConfigService;
  return new RemotiveSource(configService);
}

describe('RemotiveSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('produces no targets when disabled', () => {
    const configService = {
      load: () => makeTestConfig({ sources: { greenhouse: [], lever: [], lever_eu: [], ashby: [] } }),
    } as unknown as ConfigService;
    expect(new RemotiveSource(configService).targets()).toEqual([]);
  });

  it('produces one target per configured category, carrying minIntervalHours', () => {
    const source = makeSource();
    expect(source.targets()).toEqual([{ source: 'remotive', board: 'software-dev', minIntervalHours: 12 }]);
  });

  it('maps a real Remotive response into RawJob[]', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'remotive', board: 'software-dev' });

    expect(jobs).toHaveLength(fixture.jobs.length);
    const first = jobs[0];
    expect(first.source).toBe('remotive');
    expect(first.externalId).toBe(String(fixture.jobs[0].id));
    expect(first.company).toBe(fixture.jobs[0].company_name);
    expect(first.title).toBe(fixture.jobs[0].title);
    expect(first.url).toBe(fixture.jobs[0].url);
    expect(first.applyUrl).toBe(fixture.jobs[0].url);
    expect(first.remote).toBe(true);
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ notJobs: [] });
    const source = makeSource();
    await expect(source.fetch({ source: 'remotive', board: 'software-dev' })).rejects.toThrow(/unexpected response shape/);
  });

  it('throws a clear AppError on 404', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();
    await expect(source.fetch({ source: 'remotive', board: 'software-dev' })).rejects.toThrow(AppError);
  });
});
