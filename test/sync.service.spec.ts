import { JobsRepository } from '../src/db/jobs.repository';
import { PrismaService } from '../src/db/prisma.service';
import { ExtractorService } from '../src/jobs/extractor.service';
import { FilterService } from '../src/jobs/filter.service';
import { SyncService } from '../src/jobs/sync.service';
import { JobSource, RawJob, SourceTarget } from '../src/sources/source.interface';
import { SourcesService } from '../src/sources/sources.service';
import { ConfigService } from '../src/config/config.service';
import { makeTestConfig } from './helpers/fake-config';
import { createTempHome } from './helpers/temp-home';

function makeNoopExtractorService(): ExtractorService {
  return { extractDue: async () => ({ attempted: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 }) } as unknown as ExtractorService;
}

class FakeSource implements JobSource {
  constructor(
    readonly name: JobSource['name'],
    private readonly board: string,
    private jobs: RawJob[] | (() => RawJob[]),
    private readonly shouldFail = false,
    private readonly minIntervalHours?: number,
  ) {}

  targets(): SourceTarget[] {
    return [{ source: this.name, board: this.board, minIntervalHours: this.minIntervalHours }];
  }

  async fetch(): Promise<RawJob[]> {
    if (this.shouldFail) throw new Error('simulated fetch failure');
    return typeof this.jobs === 'function' ? this.jobs() : this.jobs;
  }
}

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'greenhouse',
    board: 'acme',
    externalId: '1',
    company: 'Acme Inc',
    title: 'Backend Engineer',
    location: 'Berlin, Germany',
    url: 'https://example.com/jobs/1',
    descriptionText: 'Build things.',
    ...overrides,
  };
}

function makeSyncService(sources: JobSource[]): SyncService {
  const configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  const sourcesService = { all: () => sources, bySourceName: () => undefined } as unknown as SourcesService;
  const jobsRepository = new JobsRepository(new PrismaService());
  const filterService = new FilterService(configService);
  return new SyncService(configService, sourcesService, jobsRepository, filterService, makeNoopExtractorService());
}

describe('SyncService', () => {
  let cleanup: () => void;
  let jobsRepository: JobsRepository;

  beforeEach(async () => {
    ({ cleanup } = await createTempHome());
    jobsRepository = new JobsRepository(new PrismaService());
  });

  afterEach(() => cleanup());

  it('inserts new jobs on first sync', async () => {
    const source = new FakeSource('greenhouse', 'acme', [rawJob({ externalId: '1' }), rawJob({ externalId: '2', title: 'Frontend Engineer' })]);
    const sync = makeSyncService([source]);

    const stats = await sync.sync();

    expect(stats).toMatchObject({ targetsOk: 1, targetsFailed: 0, fetched: 2, inserted: 2, changed: 0, unchanged: 0 });
    const jobs = await jobsRepository.findForList({ limit: 10 });
    expect(jobs).toHaveLength(2);
  });

  it('reports 0 new / 0 changed on an identical second sync', async () => {
    const jobs = [rawJob({ externalId: '1' }), rawJob({ externalId: '2', title: 'Frontend Engineer' })];
    const sync = makeSyncService([new FakeSource('greenhouse', 'acme', jobs)]);

    await sync.sync();
    const second = await sync.sync();

    expect(second).toMatchObject({ inserted: 0, changed: 0, unchanged: 2 });
  });

  it('detects a changed description on the next sync', async () => {
    let description = 'Build things.';
    const source = new FakeSource('greenhouse', 'acme', () => [rawJob({ externalId: '1', descriptionText: description })]);
    const sync = makeSyncService([source]);

    await sync.sync();
    description = 'Build even more things.';
    const stats = await sync.sync();

    expect(stats).toMatchObject({ inserted: 0, changed: 1, unchanged: 0 });
  });

  it('does not abort the whole sync when one source fails', async () => {
    const good = new FakeSource('greenhouse', 'acme', [rawJob({ externalId: '1' })]);
    const bad = new FakeSource('greenhouse', 'broken', [], true);
    const sync = makeSyncService([good, bad]);

    const stats = await sync.sync();

    expect(stats.targetsOk).toBe(1);
    expect(stats.targetsFailed).toBe(1);
    expect(stats.failedTargets).toEqual([{ source: 'greenhouse', board: 'broken', error: 'simulated fetch failure' }]);
    expect(stats.inserted).toBe(1);
  });

  it('lets an ATS listing win a cross-source duplicate against a remote-board listing', async () => {
    const sameListing = { company: 'Acme Inc', title: 'Backend Engineer', location: 'Berlin, Germany' };
    const remote = new FakeSource('remotive', 'feed', [rawJob({ ...sameListing, source: 'remotive', board: 'feed', externalId: 'r1' })]);
    const ats = new FakeSource('greenhouse', 'acme', [rawJob({ ...sameListing, source: 'greenhouse', board: 'acme', externalId: 'g1' })]);
    // Order matters: remote is processed first so it becomes "existing" when the ATS job is upserted next.
    const sync = makeSyncService([remote, ats]);

    const stats = await sync.sync();

    expect(stats.inserted).toBe(2);
    expect(stats.duplicates).toBe(1);

    const remoteJob = await jobsRepository.findExistingByKey('remotive', 'feed', 'r1');
    const atsJob = await jobsRepository.findExistingByKey('greenhouse', 'acme', 'g1');
    expect(atsJob?.duplicateOfId).toBeNull();
    expect(remoteJob?.duplicateOfId).toBe(atsJob?.id);
  });

  it('closes a job that disappears from a successful fetch', async () => {
    let jobs = [rawJob({ externalId: '1' }), rawJob({ externalId: '2', title: 'Frontend Engineer' })];
    const source = new FakeSource('greenhouse', 'acme', () => jobs);
    const sync = makeSyncService([source]);

    await sync.sync();
    jobs = [rawJob({ externalId: '1' })];
    const stats = await sync.sync();

    expect(stats.closed).toBe(1);
    const closedJob = await jobsRepository.findExistingByKey('greenhouse', 'acme', '2');
    expect(closedJob?.closedAt).not.toBeNull();
    const stillOpen = await jobsRepository.findExistingByKey('greenhouse', 'acme', '1');
    expect(stillOpen?.closedAt).toBeNull();
  });

  it('clears closedAt when a closed job reappears', async () => {
    let jobs = [rawJob({ externalId: '1' }), rawJob({ externalId: '2' })];
    const source = new FakeSource('greenhouse', 'acme', () => jobs);
    const sync = makeSyncService([source]);

    await sync.sync();
    jobs = [rawJob({ externalId: '1' })];
    await sync.sync();
    jobs = [rawJob({ externalId: '1' }), rawJob({ externalId: '2' })];
    await sync.sync();

    const reappeared = await jobsRepository.findExistingByKey('greenhouse', 'acme', '2');
    expect(reappeared?.closedAt).toBeNull();
  });

  it('does not close anything for a target whose fetch failed', async () => {
    let shouldFail = false;
    const jobs = [rawJob({ externalId: '1' }), rawJob({ externalId: '2' })];
    const source = new FakeSource('greenhouse', 'acme', () => {
      if (shouldFail) throw new Error('simulated fetch failure');
      return jobs;
    });
    const sync = makeSyncService([source]);

    await sync.sync();
    shouldFail = true;
    const stats = await sync.sync();

    expect(stats.targetsFailed).toBe(1);
    expect(stats.closed).toBe(0);
    const job1 = await jobsRepository.findExistingByKey('greenhouse', 'acme', '1');
    const job2 = await jobsRepository.findExistingByKey('greenhouse', 'acme', '2');
    expect(job1?.closedAt).toBeNull();
    expect(job2?.closedAt).toBeNull();
  });

  it('stores a rejected job with its filter reason instead of dropping it', async () => {
    const configService = { load: () => makeTestConfig({ filters: { ...makeTestConfig().filters, titleInclude: ['frontend'] } }) } as unknown as ConfigService;
    const jobsRepository2 = new JobsRepository(new PrismaService());
    const sourcesService = {
      all: () => [new FakeSource('greenhouse', 'acme', [rawJob({ title: 'Backend Engineer' })])],
      bySourceName: () => undefined,
    } as unknown as SourcesService;
    const sync = new SyncService(configService, sourcesService, jobsRepository2, new FilterService(configService), makeNoopExtractorService());

    const stats = await sync.sync();

    expect(stats.filterRejected).toBe(1);
    expect(stats.filterPassed).toBe(0);
    const job = await jobsRepository2.findExistingByKey('greenhouse', 'acme', '1');
    expect(job?.filterStatus).toBe('rejected');
    expect(job?.filterReason).toBe('title-no-match');
  });

  it('reclassifies an existing job when the config changes without a content change', async () => {
    const permissive = makeTestConfig();
    let config = permissive;
    const configService = { load: () => config } as unknown as ConfigService;
    const source = new FakeSource('greenhouse', 'acme', [rawJob({ title: 'Backend Engineer' })]);
    const sourcesService = { all: () => [source], bySourceName: () => undefined } as unknown as SourcesService;
    const filterService = new FilterService(configService);
    const sync = new SyncService(configService, sourcesService, jobsRepository, filterService, makeNoopExtractorService());

    await sync.sync();
    config = makeTestConfig({ filters: { ...permissive.filters, titleInclude: ['frontend'] } });
    const stats = await sync.sync();

    expect(stats.reclassified).toBe(1);
    const job = await jobsRepository.findExistingByKey('greenhouse', 'acme', '1');
    expect(job?.filterStatus).toBe('rejected');
    expect(job?.filterReason).toBe('title-no-match');
  });

  describe('minIntervalHours throttling (remote-board sources)', () => {
    it('skips a target fetched more recently than its minIntervalHours, without calling fetch again', async () => {
      const fetchSpy = jest.fn(() => [rawJob({ source: 'remotive', board: 'software-dev', externalId: '1' })]);
      const source = new FakeSource('remotive', 'software-dev', fetchSpy, false, 12);
      const sync = makeSyncService([source]);

      await sync.sync();
      const second = await sync.sync();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(second.targetsSkipped).toBe(1);
      expect(second.skippedTargets).toEqual([{ source: 'remotive', board: 'software-dev', reason: expect.stringContaining('ago') }]);
      expect(second.targetsOk).toBe(0);
      expect(second.targetsFailed).toBe(0);
    });

    it('fetches again once minIntervalHours has elapsed', async () => {
      const fetchSpy = jest.fn(() => [rawJob({ source: 'remotive', board: 'software-dev', externalId: '1' })]);
      const source = new FakeSource('remotive', 'software-dev', fetchSpy, false, 12);
      const sync = makeSyncService([source]);

      await sync.sync();
      const prisma = new PrismaService();
      await prisma.sourceState.update({
        where: { source_board: { source: 'remotive', board: 'software-dev' } },
        data: { lastFetchedAt: new Date(Date.now() - 13 * 3_600_000) },
      });

      const second = await sync.sync();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(second.targetsSkipped).toBe(0);
      expect(second.targetsOk).toBe(1);
    });

    it('does not throttle a target with no minIntervalHours (ATS sources)', async () => {
      const fetchSpy = jest.fn(() => [rawJob({ externalId: '1' })]);
      const source = new FakeSource('greenhouse', 'acme', fetchSpy);
      const sync = makeSyncService([source]);

      await sync.sync();
      const second = await sync.sync();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(second.targetsSkipped).toBe(0);
    });
  });

  describe('new match highlights', () => {
    function makeScoringExtractorService(scoreByExternalId: Record<string, number>): ExtractorService {
      return {
        extractDue: async (limit: number) => {
          const due = await jobsRepository.findJobsNeedingExtraction('any', limit);
          for (const job of due) {
            const score = scoreByExternalId[job.externalId] ?? 0;
            await jobsRepository.saveExtraction(job.id, {
              contentHash: job.contentHash,
              promptVersion: 'any',
              model: 'test',
              roleSummary: 'x',
              requirements: [],
              niceToHave: [],
              stack: [],
              seniority: 'mid',
              yearsExperienceMin: null,
              remotePolicy: 'remote',
              locationRestriction: null,
              matchScore: score,
              matchReasons: [],
              gaps: [],
              redFlags: [],
            });
          }
          return { attempted: due.length, succeeded: due.length, failed: 0, inputTokens: 0, outputTokens: 0 };
        },
      } as unknown as ExtractorService;
    }

    it('highlights only newly inserted jobs scoring at or above sync.minScoreToHighlight', async () => {
      const configService = {
        load: () => makeTestConfig({ sync: { ...makeTestConfig().sync, minScoreToHighlight: 70 } }),
      } as unknown as ConfigService;
      const source = new FakeSource('greenhouse', 'acme', [
        rawJob({ externalId: '1', title: 'High scorer', remote: true }),
        rawJob({ externalId: '2', title: 'Low scorer', remote: true }),
      ]);
      const sourcesService = { all: () => [source], bySourceName: () => undefined } as unknown as SourcesService;
      const extractorService = makeScoringExtractorService({ '1': 92, '2': 40 });
      const sync = new SyncService(configService, sourcesService, jobsRepository, new FilterService(configService), extractorService);

      const stats = await sync.sync();

      expect(stats.newMatches).toHaveLength(1);
      expect(stats.newMatches[0]).toMatchObject({ score: 92, title: 'High scorer' });
    });

    it('does not highlight a job that was already known before this sync (only genuinely new ones)', async () => {
      const configService = {
        load: () => makeTestConfig({ sync: { ...makeTestConfig().sync, minScoreToHighlight: 70 } }),
      } as unknown as ConfigService;
      const source = new FakeSource('greenhouse', 'acme', [rawJob({ externalId: '1', remote: true })]);
      const sourcesService = { all: () => [source], bySourceName: () => undefined } as unknown as SourcesService;
      const extractorService = makeScoringExtractorService({ '1': 95 });
      const sync = new SyncService(configService, sourcesService, jobsRepository, new FilterService(configService), extractorService);

      const first = await sync.sync();
      const second = await sync.sync();

      expect(first.newMatches).toHaveLength(1);
      expect(second.newMatches).toHaveLength(0);
    });
  });
});
