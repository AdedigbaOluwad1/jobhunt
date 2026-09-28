import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { WwrSource } from '../src/sources/wwr.source';
import { makeTestConfig } from './helpers/fake-config';

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'wwr.rss'), 'utf8');

function makeSource(feeds: string[] = ['remote-programming-jobs']) {
  const configService = {
    load: () =>
      makeTestConfig({
        sources: {
          greenhouse: [],
          lever: [],
          lever_eu: [],
          ashby: [],
          remote: { wwr: { enabled: true, feeds, minIntervalHours: 12 } },
        },
      }),
  } as unknown as ConfigService;
  return new WwrSource(configService);
}

describe('WwrSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('produces no targets when disabled', () => {
    const configService = {
      load: () => makeTestConfig({ sources: { greenhouse: [], lever: [], lever_eu: [], ashby: [] } }),
    } as unknown as ConfigService;
    expect(new WwrSource(configService).targets()).toEqual([]);
  });

  it('produces one target per configured feed, carrying minIntervalHours', () => {
    expect(makeSource().targets()).toEqual([{ source: 'wwr', board: 'remote-programming-jobs', minIntervalHours: 12 }]);
  });

  it('parses "Company: Title" from the RSS item title', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue(fixture);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'wwr', board: 'remote-programming-jobs' });

    expect(jobs).toHaveLength(3);
    expect(jobs[0].company).toBe('Reddit');
    expect(jobs[0].title).toBe('Backend Engineer, IAM');
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].url).toBe('https://weworkremotely.com/remote-jobs/reddit-backend-engineer-iam');
    expect(jobs[0].externalId).toBe('https://weworkremotely.com/remote-jobs/reddit-backend-engineer-iam');
    expect(jobs[0].postedAt).toBeInstanceOf(Date);
  });

  it('falls back to a slugified board name as company when there is no ": " separator', async () => {
    const noSeparatorXml = fixture.replace('Reddit: Backend Engineer, IAM', 'Just A Title With No Separator');
    jest.spyOn(http, 'fetchText').mockResolvedValue(noSeparatorXml);
    const source = makeSource();

    const [job] = await source.fetch({ source: 'wwr', board: 'remote-programming-jobs' });

    expect(job.company).toBe('Remote Programming Jobs');
    expect(job.title).toBe('Just A Title With No Separator');
  });

  it('normalizes a single-item feed (fast-xml-parser gives an object, not an array) into RawJob[]', async () => {
    const singleItemXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Test feed</title>
  <item>
    <title>Acme: Backend Engineer</title>
    <region>Anywhere</region>
    <description>&lt;p&gt;Do the thing.&lt;/p&gt;</description>
    <pubDate>Mon, 14 Sep 2026 07:31:07 +0000</pubDate>
    <guid>https://weworkremotely.com/remote-jobs/acme-backend-engineer</guid>
    <link>https://weworkremotely.com/remote-jobs/acme-backend-engineer</link>
  </item>
</channel></rss>`;
    jest.spyOn(http, 'fetchText').mockResolvedValue(singleItemXml);
    const source = makeSource();

    const jobs = await source.fetch({ source: 'wwr', board: 'remote-programming-jobs' });
    expect(jobs).toHaveLength(1);
    expect(jobs[0].company).toBe('Acme');
  });

  it('throws a clear AppError on 404', async () => {
    jest.spyOn(http, 'fetchText').mockRejectedValue(new HttpError(404, 'https://example.com'));
    const source = makeSource();
    await expect(source.fetch({ source: 'wwr', board: 'remote-programming-jobs' })).rejects.toThrow(AppError);
  });
});
