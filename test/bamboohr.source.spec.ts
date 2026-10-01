import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { BambooHrSource } from '../src/sources/bamboohr.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): BambooHrSource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new BambooHrSource(configService);
}

describe('BambooHrSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('combines the openings list with each opening detail', async () => {
    const list = readJson('bamboohr-list.json');
    const detail = readJson('bamboohr-detail.json');
    const spy = jest.spyOn(http, 'fetchJson').mockImplementation(async (url: string) => (url.endsWith('/list') ? list : detail));

    const jobs = await makeSource().fetch({ source: 'bamboohr', board: 'flutterwavego' });

    expect(jobs).toHaveLength(list.result.length);
    expect(spy).toHaveBeenCalledWith('https://flutterwavego.bamboohr.com/careers/list', expect.anything());
    const [first] = jobs;
    expect(first.externalId).toBe(list.result[0].id);
    expect(first.title).toBe(list.result[0].jobOpeningName);
    expect(first.department).toBe(list.result[0].departmentLabel);
    expect(first.location).toBe('Lekki, Lagos, Nigeria');
    expect(first.url).toBe(detail.result.jobOpening.jobOpeningShareUrl);
    expect(first.descriptionHtml).toBe(detail.result.jobOpening.description);
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('fails the whole fetch if one detail request fails, rather than returning partial data', async () => {
    const list = readJson('bamboohr-list.json');
    jest
      .spyOn(http, 'fetchJson')
      .mockImplementation(async (url: string) => {
        if (url.endsWith('/list')) return list;
        throw new HttpError(500, url);
      });

    await expect(makeSource().fetch({ source: 'bamboohr', board: 'flutterwavego' })).rejects.toThrow(AppError);
  });

  it('throws a clear AppError on 404 (bad account)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'bamboohr', board: 'nope' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'bamboohr', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ unexpected: true });
    const source = makeSource();

    await expect(source.fetch({ source: 'bamboohr', board: 'nope' })).rejects.toThrow(/unexpected response shape/);
  });
});
