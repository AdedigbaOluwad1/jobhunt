import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { SmartRecruitersSource } from '../src/sources/smartrecruiters.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): SmartRecruitersSource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new SmartRecruitersSource(configService);
}

describe('SmartRecruitersSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('combines the postings list with each posting detail', async () => {
    const list = { ...readJson('smartrecruiters-list.json'), totalFound: 2 };
    const detail = readJson('smartrecruiters-detail.json');
    jest.spyOn(http, 'fetchJson').mockImplementation(async (url: string) => (url.includes('?limit=') ? list : detail));

    const jobs = await makeSource().fetch({ source: 'smartrecruiters', board: 'BoschGroup' });

    expect(jobs).toHaveLength(2);
    const [first] = jobs;
    expect(first.source).toBe('smartrecruiters');
    expect(first.externalId).toBe(list.content[0].id);
    expect(first.company).toBe('Bosch Group');
    expect(first.title).toBe(list.content[0].name);
    expect(first.location).toBe(list.content[0].location.fullLocation);
    expect(first.employmentType).toBe('Full-time');
    expect(first.url).toBe(detail.postingUrl);
    expect(first.descriptionHtml).toContain('Company Description');
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('pages through the list until totalFound is reached', async () => {
    const page = readJson('smartrecruiters-list.json');
    const detail = readJson('smartrecruiters-detail.json');
    const spy = jest.spyOn(http, 'fetchJson').mockImplementation(async (url: string) => {
      if (!url.includes('?limit=')) return detail;
      return { ...page, totalFound: 4 };
    });

    const jobs = await makeSource().fetch({ source: 'smartrecruiters', board: 'BoschGroup' });

    expect(jobs).toHaveLength(4);
    const listCalls = spy.mock.calls.filter(([url]) => (url as string).includes('?limit='));
    expect(listCalls).toHaveLength(2);
    expect(listCalls[1][0]).toContain('offset=100');
  });

  it('throws a clear AppError on 404 (bad account)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'smartrecruiters', board: 'nope' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'smartrecruiters', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ unexpected: true });
    const source = makeSource();

    await expect(source.fetch({ source: 'smartrecruiters', board: 'nope' })).rejects.toThrow(/unexpected response shape/);
  });
});
