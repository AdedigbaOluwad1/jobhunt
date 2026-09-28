import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { LeverSource } from '../src/sources/lever.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lever-veeva.json'), 'utf8'));

function makeSource(configOverrides = {}) {
  const configService = { load: () => makeTestConfig(configOverrides) } as unknown as ConfigService;
  return new LeverSource(configService);
}

describe('LeverSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a real Lever response into RawJob[]', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'lever', board: 'veeva' });

    expect(jobs).toHaveLength(fixture.length);
    const first = jobs[0];
    expect(first.source).toBe('lever');
    expect(first.externalId).toBe(fixture[0].id);
    expect(first.title).toBe(fixture[0].text);
    expect(first.location).toBe(fixture[0].categories.location);
    expect(first.url).toBe(fixture[0].hostedUrl);
    expect(first.applyUrl).toBe(fixture[0].applyUrl);
    expect(first.descriptionText).toBe(fixture[0].descriptionPlain);
    expect(first.remote).toBe(fixture[0].workplaceType === 'remote');
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('derives company from the board slug when there is no override', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue([fixture[0]]);
    const source = makeSource();

    const [job] = await source.fetch({ source: 'lever', board: 'veeva' });

    expect(job.company).toBe('Veeva');
  });

  it('uses the EU host for boards listed under sources.lever_eu', async () => {
    const spy = jest.spyOn(http, 'fetchJson').mockResolvedValue([]);
    const source = makeSource({
      sources: { greenhouse: [], lever: [], lever_eu: ['somecompany'], ashby: [] },
    });

    await source.fetch({ source: 'lever', board: 'somecompany' });

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('api.eu.lever.co'), expect.anything());
  });

  it('throws a clear AppError on 404', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'lever', board: 'does-not-exist' })).rejects.toThrow(AppError);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ not: 'an array' });
    const source = makeSource();

    await expect(source.fetch({ source: 'lever', board: 'veeva' })).rejects.toThrow(/unexpected response shape/);
  });
});
