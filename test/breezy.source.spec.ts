import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { BreezySource } from '../src/sources/breezy.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): BreezySource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new BreezySource(configService);
}

describe('BreezySource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a Breezy /json response into RawJob[]', async () => {
    const fixture = readJson('breezy-demo.json');
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);

    const jobs = await makeSource().fetch({ source: 'breezy', board: 'breezy' });

    expect(jobs).toHaveLength(fixture.length);
    const [first] = jobs;
    expect(first.source).toBe('breezy');
    expect(first.externalId).toBe(fixture[0].id);
    expect(first.company).toBe('MS Breezy Trial');
    expect(first.title).toBe(fixture[0].name);
    expect(first.location).toBe('Chaos, FL');
    expect(first.remote).toBe(false);
    expect(first.salaryText).toBe(fixture[0].salary);
    expect(first.url).toBe(fixture[0].url);
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('throws a clear AppError on 404 (bad account)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'breezy', board: 'nope' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'breezy', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ notAnArray: true });
    const source = makeSource();

    await expect(source.fetch({ source: 'breezy', board: 'nope' })).rejects.toThrow(/unexpected response shape/);
  });
});
