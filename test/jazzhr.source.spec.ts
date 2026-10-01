import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../src/common/errors';
import * as http from '../src/common/http';
import { HttpError } from '../src/common/http';
import { ConfigService } from '../src/config/config.service';
import { JazzHrSource } from '../src/sources/jazzhr.source';
import { makeTestConfig } from './helpers/fake-config';

const readFixture = (file: string) => fs.readFileSync(path.join(__dirname, 'fixtures', file), 'utf8');

function makeSource(): JazzHrSource {
  const configService = {
    load: () =>
      makeTestConfig({ sources: { ...makeTestConfig().sources, companyNames: { palmpaylimited: 'PalmPay' } } }),
  } as unknown as ConfigService;
  return new JazzHrSource(configService);
}

describe('JazzHrSource', () => {
  afterEach(() => jest.restoreAllMocks());

  it('combines the HTML listing with each posting JSON-LD', async () => {
    const list = readFixture('jazzhr-palmpay-list.html');
    const detail = readFixture('jazzhr-palmpay-detail.html');
    jest.spyOn(http, 'fetchText').mockImplementation(async (url: string) => (url.endsWith('/apply') ? list : detail));

    const jobs = await makeSource().fetch({ source: 'jazzhr', board: 'palmpaylimited' });

    expect(jobs).toHaveLength(3);
    const [first] = jobs;
    expect(first.source).toBe('jazzhr');
    expect(first.externalId).toBe('LlnlAU4B1c');
    expect(first.company).toBe('PalmPay');
    expect(first.title).toBe('Field Verification Officer');
    expect(first.location).toBeTruthy();
    expect(first.employmentType).toBe('FULL_TIME');
    expect(first.url).toBe('https://palmpaylimited.applytojob.com/apply/LlnlAU4B1c/Business-Developer-PWT');
    expect(first.descriptionHtml).toContain('on-site');
    expect(first.postedAt).toEqual(new Date('2026-09-01'));
  });

  it('falls back to the rendered description when a posting has no JobPosting JSON-LD', async () => {
    const list = readFixture('jazzhr-palmpay-list.html');
    const detail = readFixture('jazzhr-palmpay-detail-no-jsonld.html');
    jest.spyOn(http, 'fetchText').mockImplementation(async (url: string) => (url.endsWith('/apply') ? list : detail));

    const [first] = await makeSource().fetch({ source: 'jazzhr', board: 'palmpaylimited' });

    expect(first.title).toBe('Business Developer (PWT)');
    expect(first.descriptionHtml).toContain('Job Summary');
    expect(first.postedAt).toBeUndefined();
  });

  it('fails the whole fetch if a posting has no description at all, rather than returning partial data', async () => {
    const list = readFixture('jazzhr-palmpay-list.html');
    jest
      .spyOn(http, 'fetchText')
      .mockImplementation(async (url: string) => (url.endsWith('/apply') ? list : '<html></html>'));

    await expect(makeSource().fetch({ source: 'jazzhr', board: 'palmpaylimited' })).rejects.toThrow(AppError);
  });

  it('throws a clear AppError on 404 (bad careers subdomain)', async () => {
    jest.spyOn(http, 'fetchText').mockRejectedValue(new HttpError(404, 'https://example.com'));

    await expect(makeSource().fetch({ source: 'jazzhr', board: 'nope' })).rejects.toThrow(/404/);
  });

  it('throws a clear AppError when the page is not a JazzHR careers list', async () => {
    jest.spyOn(http, 'fetchText').mockResolvedValue('<html><body>something else</body></html>');

    await expect(makeSource().fetch({ source: 'jazzhr', board: 'nope' })).rejects.toThrow(/no job list found/);
  });
});
