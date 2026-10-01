import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { WorkableSource } from '../src/sources/workable.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): WorkableSource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new WorkableSource(configService);
}

describe('WorkableSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a Workable widget response into RawJob[]', async () => {
    const fixture = readJson('workable-huggingface.json');
    jest.spyOn(http, 'fetchJson').mockResolvedValue(fixture);

    const jobs = await makeSource().fetch({ source: 'workable', board: 'huggingface' });

    expect(jobs).toHaveLength(fixture.jobs.length);
    const [first] = jobs;
    expect(first.source).toBe('workable');
    expect(first.externalId).toBe(fixture.jobs[0].shortcode);
    expect(first.company).toBe(fixture.name);
    expect(first.title).toBe(fixture.jobs[0].title);
    expect(first.location).toBe('Paris, France');
    expect(first.remote).toBe(true);
    expect(first.applyUrl).toBe(fixture.jobs[0].application_url);
    expect(first.descriptionHtml).toBe(fixture.jobs[0].description);
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('returns no jobs for an account with no openings', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ name: 'Paystack', description: null, jobs: [] });

    await expect(makeSource().fetch({ source: 'workable', board: 'paystack' })).resolves.toEqual([]);
  });

  it('throws a clear AppError on 404 (bad account)', async () => {
    jest.spyOn(http, 'fetchJson').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();

    await expect(source.fetch({ source: 'workable', board: 'nope' })).rejects.toThrow(AppError);
    await expect(source.fetch({ source: 'workable', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response fails schema validation', async () => {
    jest.spyOn(http, 'fetchJson').mockResolvedValue({ unexpected: true });
    const source = makeSource();

    await expect(source.fetch({ source: 'workable', board: 'nope' })).rejects.toThrow(/unexpected response shape/);
  });
});
