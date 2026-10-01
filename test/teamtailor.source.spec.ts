import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { TeamtailorSource } from '../src/sources/teamtailor.source';
import { makeTestConfig } from './helpers/fake-config';

const fixtureDir = path.join(__dirname, 'fixtures');
const readFixture = (file: string) => fs.readFileSync(path.join(fixtureDir, file), 'utf8');
const readJson = (file: string) => JSON.parse(readFixture(file));

function makeSource(): TeamtailorSource {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  return new TeamtailorSource(configService);
}

describe('TeamtailorSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('maps a Teamtailor RSS feed into RawJob[]', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(readFixture('teamtailor-paystack.rss'));

    const jobs = await makeSource().fetch({ source: 'teamtailor', board: 'careers.paystack.com' });

    expect(jobs).toHaveLength(2);
    const [first] = jobs;
    expect(first.source).toBe('teamtailor');
    expect(first.company).toBe('Paystack');
    expect(first.title).toBe('Product Manager - Financial Systems');
    expect(first.location).toBe('Lagos, Nigeria');
    expect(first.department).toBe('Product');
    expect(first.remote).toBe(false);
    expect(first.url).toMatch(/^https:\/\/careers\.paystack\.com\/jobs\//);
    expect(first.descriptionHtml).toContain('About Paystack');
    expect(first.postedAt).toBeInstanceOf(Date);
  });

  it('treats a feed with no items as zero jobs', async () => {
    jest
      .spyOn(http, 'fetchText')
      .mockResolvedValue('<?xml version="1.0"?><rss version="2.0"><channel><title>Acme</title></channel></rss>');

    await expect(makeSource().fetch({ source: 'teamtailor', board: 'acme.teamtailor.com' })).resolves.toEqual([]);
  });

  it('throws a clear AppError on 404 (bad careers host)', async () => {
    jest.spyOn(http, 'fetchText').mockRejectedValue(new HttpError(404, 'https://example.com'));

    await expect(makeSource().fetch({ source: 'teamtailor', board: 'nope.example.com' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the response is not an RSS feed', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue('<html><body>not a feed</body></html>');

    await expect(makeSource().fetch({ source: 'teamtailor', board: 'nope.example.com' })).rejects.toThrow(
      /unexpected response shape/,
    );
  });
});
