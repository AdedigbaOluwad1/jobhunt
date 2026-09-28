/**
 * Opt-in only (`npm run test:live`) — one real request per adapter against
 * the actual public API/feed, to catch upstream shape drift that fixture-
 * based tests can't. Never run as part of the default `npm test`.
 */
import { AshbySource } from '../../src/sources/ashby.source';
import { ConfigService } from '../../src/config/config.service';
import { GreenhouseSource } from '../../src/sources/greenhouse.source';
import { LeverSource } from '../../src/sources/lever.source';
import { RemoteOkSource } from '../../src/sources/remoteok.source';
import { RemotiveSource } from '../../src/sources/remotive.source';
import { WwrSource } from '../../src/sources/wwr.source';
import { makeTestConfig } from '../helpers/fake-config';

function configService(sources: Partial<ReturnType<typeof makeTestConfig>['sources']>): ConfigService {
  return {
    load: () => makeTestConfig({ sources: { greenhouse: [], lever: [], lever_eu: [], ashby: [], ...sources } }),
  } as unknown as ConfigService;
}

describe('live adapter smoke tests', () => {
  it('greenhouse: fetches a real board', async () => {
    const source = new GreenhouseSource(configService({ greenhouse: ['figma'] }));
    const jobs = await source.fetch({ source: 'greenhouse', board: 'figma' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toMatchObject({ source: 'greenhouse', company: expect.any(String), title: expect.any(String) });
  });

  it('lever: fetches a real board', async () => {
    const source = new LeverSource(configService({ lever: ['veeva'] }));
    const jobs = await source.fetch({ source: 'lever', board: 'veeva' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toMatchObject({ source: 'lever', title: expect.any(String) });
  });

  it('ashby: fetches a real board', async () => {
    const source = new AshbySource(configService({ ashby: ['linear'] }));
    const jobs = await source.fetch({ source: 'ashby', board: 'linear' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toMatchObject({ source: 'ashby', title: expect.any(String) });
  });

  it('remotive: fetches the live feed', async () => {
    const source = new RemotiveSource(
      configService({ remote: { remotive: { enabled: true, categories: ['software-dev'], minIntervalHours: 12 } } }),
    );
    const jobs = await source.fetch({ source: 'remotive', board: 'software-dev' });
    expect(Array.isArray(jobs)).toBe(true);
  });

  it('remoteok: fetches the live feed', async () => {
    const source = new RemoteOkSource(configService({ remote: { remoteok: { enabled: true, minIntervalHours: 12 } } }));
    const jobs = await source.fetch({ source: 'remoteok', board: 'all' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('wwr: fetches the live RSS feed', async () => {
    const source = new WwrSource(
      configService({ remote: { wwr: { enabled: true, feeds: ['remote-programming-jobs'], minIntervalHours: 12 } } }),
    );
    const jobs = await source.fetch({ source: 'wwr', board: 'remote-programming-jobs' });
    expect(Array.isArray(jobs)).toBe(true);
    expect(jobs.length).toBeGreaterThan(0);
  });
});
