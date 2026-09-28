import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { RemoteOkSource } from '../src/sources/remoteok.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'remoteok.json'), 'utf8'));

function makeSource(enabled = true) {
  const configService = {
    load: () =>
      makeTestConfig({
        sources: {
          greenhouse: [],
          lever: [],
          lever_eu: [],
          ashby: [],
          remote: { remoteok: { enabled, minIntervalHours: 12 } },
        },
      }),
  } as unknown as ConfigService;
  return new RemoteOkSource(configService);
}

describe('RemoteOkSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('produces no targets when disabled', () => {
    expect(makeSource(false).targets()).toEqual([]);
  });

  it('produces a single "all" target carrying minIntervalHours', () => {
    expect(makeSource().targets()).toEqual([{ source: 'remoteok', board: 'all', minIntervalHours: 12 }]);
  });

  it('skips the first array element (legal notice) and maps the rest into RawJob[]', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'remoteok', board: 'all' });

    expect(jobs).toHaveLength(fixture.length - 1);
    const first = jobs[0];
    const rawFirst = fixture[1];
    expect(first.source).toBe('remoteok');
    expect(first.externalId).toBe(String(rawFirst.id));
    expect(first.company).toBe(rawFirst.company);
    expect(first.title).toBe(rawFirst.position);
    expect(first.url).toBe(rawFirst.url);
    expect(first.remote).toBe(true);
  });

  it('throws a clear AppError when the response is not a non-empty array', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ not: 'an array' });
    const source = makeSource();
    await expect(source.fetch({ source: 'remoteok', board: 'all' })).rejects.toThrow(/unexpected response shape/);
  });

  it('throws a clear AppError on 404', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();
    await expect(source.fetch({ source: 'remoteok', board: 'all' })).rejects.toThrow(AppError);
  });
});
