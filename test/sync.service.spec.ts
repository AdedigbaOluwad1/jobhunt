import { JobsRepository } from '../src/db/jobs.repository';
import { PrismaService } from '../src/db/prisma.service';
import { SyncService } from '../src/jobs/sync.service';
import { JobSource, RawJob, SourceTarget } from '../src/sources/source.interface';
import { SourcesService } from '../src/sources/sources.service';
import { ConfigService } from '../src/config/config.service';
import { makeTestConfig } from './helpers/fake-config';
import { createTempHome } from './helpers/temp-home';

class FakeSource implements JobSource {
  constructor(
    readonly name: JobSource['name'],
    private readonly board: string,
    private jobs: RawJob[] | (() => RawJob[]),
    private readonly shouldFail = false,
  ) {}

  targets(): SourceTarget[] {
    return [{ source: this.name, board: this.board }];
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
  return new SyncService(configService, sourcesService, jobsRepository);
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
});
