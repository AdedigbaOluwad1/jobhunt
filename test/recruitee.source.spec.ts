import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { RecruiteeSource } from '../src/sources/recruitee.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): RecruiteeSource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new RecruiteeSource(configService);
}

describe('RecruiteeSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a Recruitee offers response into RawJob[]', async () => {
    const fixture = readJson('recruitee-personio.json');
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);

    const [job] = await makeSource().fetch({ source: 'recruitee', board: 'personio' });

    expect(job.source).toBe('recruitee');
    expect(job.externalId).toBe(String(fixture.offers[0].id));
    expect(job.company).toBe(fixture.offers[0].company_name);
    expect(job.title).toBe(fixture.offers[0].title);
    expect(job.location).toBe(fixture.offers[0].location);
    expect(job.remote).toBe(false);
    expect(job.url).toBe(fixture.offers[0].careers_url);
    expect(job.descriptionHtml).toContain(fixture.offers[0].description);
    expect(job.postedAt).toBeInstanceOf(Date);
  });

  it('throws a clear AppError on 404 (bad account)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'recruitee', board: 'nope' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'recruitee', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ unexpected: true });
    const source = makeSource();

    await expect(source.fetch({ source: 'recruitee', board: 'nope' })).rejects.toThrow(/unexpected response shape/);
  });
});
