import { JobsRepository } from '../src/db/jobs.repository';
import { PrismaService } from '../src/db/prisma.service';
import { normalize } from '../src/jobs/normalize';
import { RawJob } from '../src/sources/source.interface';
import { createTempHome } from './helpers/temp-home';

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'greenhouse',
    board: 'acme',
    externalId: '1',
    company: 'Acme Inc',
    title: 'Backend Engineer',
    location: 'Remote',
    remote: true,
    url: 'https://example.com/jobs/1',
    descriptionText: 'Build things.',
    ...overrides,
  };
}

describe('JobsRepository — status and stats', () => {
  let cleanup: () => void;
  let repo: JobsRepository;

  beforeEach(async () => {
    ({ cleanup } = await createTempHome());
    repo = new JobsRepository(new PrismaService());
  });

  afterEach(() => cleanup());

  async function insertJob(overrides: Partial<RawJob> = {}) {
    const { job } = await repo.upsertJob(normalize(rawJob(overrides)), { status: 'passed', reason: null });
    return job;
  }

  describe('updateStatus', () => {
    it('updates status, note, and statusUpdatedAt', async () => {
      const job = await insertJob();
      const before = job.statusUpdatedAt;

      const updated = await repo.updateStatus(job.id, 'shortlisted', 'looks promising');

      expect(updated.status).toBe('shortlisted');
      expect(updated.statusNote).toBe('looks promising');
      expect(updated.statusUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    });

    it('leaves the existing note untouched when none is given', async () => {
      const job = await insertJob();
      await repo.updateStatus(job.id, 'shortlisted', 'first note');
      const updated = await repo.updateStatus(job.id, 'interview');
      expect(updated.statusNote).toBe('first note');
    });
  });

  describe('markLatestApplicationApplied', () => {
    it('sets appliedAt on the most recent application if unset', async () => {
      const job = await insertJob();
      await repo.createApplication({ jobId: job.id, cvPdfPath: '/tmp/cv.pdf', tailoredJson: '{}' });

      await repo.markLatestApplicationApplied(job.id);

      const application = await repo.findApplicationByJobId(job.id);
      expect(application?.appliedAt).not.toBeNull();
    });

    it('does not overwrite an already-set appliedAt', async () => {
      const job = await insertJob();
      await repo.createApplication({ jobId: job.id, cvPdfPath: '/tmp/cv.pdf', tailoredJson: '{}' });
      await repo.markLatestApplicationApplied(job.id);
      const first = await repo.findApplicationByJobId(job.id);

      await new Promise((r) => setTimeout(r, 5));
      await repo.markLatestApplicationApplied(job.id);
      const second = await repo.findApplicationByJobId(job.id);

      expect(second?.appliedAt?.getTime()).toBe(first?.appliedAt?.getTime());
    });

    it('is a no-op when the job has no application', async () => {
      const job = await insertJob();
      await expect(repo.markLatestApplicationApplied(job.id)).resolves.toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('counts jobs by status', async () => {
      const a = await insertJob({ externalId: '1' });
      const b = await insertJob({ externalId: '2' });
      await repo.updateStatus(a.id, 'shortlisted');
      await repo.updateStatus(b.id, 'dismissed');

      const stats = await repo.getStats();
      expect(stats.byStatus).toMatchObject({ shortlisted: 1, dismissed: 1 });
    });

    it('averages the match score only across jobs with an application', async () => {
      const scored = await insertJob({ externalId: '1' });
      await repo.saveExtraction(scored.id, {
        contentHash: scored.contentHash,
        promptVersion: 'v1',
        model: 'test',
        roleSummary: 'x',
        requirements: [],
        niceToHave: [],
        stack: [],
        seniority: 'mid',
        yearsExperienceMin: null,
        remotePolicy: 'remote',
        locationRestriction: null,
        matchScore: 80,
        matchReasons: [],
        gaps: [],
        redFlags: [],
      });
      await repo.createApplication({ jobId: scored.id, cvPdfPath: '/tmp/a.pdf', tailoredJson: '{}' });

      // a second, unrelated job with no application shouldn't affect the average
      await insertJob({ externalId: '2' });

      const stats = await repo.getStats();
      expect(stats.avgAppliedMatchScore).toBe(80);
    });

    it('returns null average when no applications have a scored job', async () => {
      await insertJob();
      const stats = await repo.getStats();
      expect(stats.avgAppliedMatchScore).toBeNull();
    });

    it('picks the source with the most passed+extracted jobs as top source', async () => {
      const gh1 = await insertJob({ source: 'greenhouse', board: 'acme', externalId: '1' });
      const gh2 = await insertJob({ source: 'greenhouse', board: 'acme', externalId: '2' });
      const ashby1 = await insertJob({ source: 'ashby', board: 'other', externalId: '3' });

      const extractionPayload = {
        contentHash: '',
        promptVersion: 'v1',
        model: 'test',
        roleSummary: 'x',
        requirements: [],
        niceToHave: [],
        stack: [],
        seniority: 'mid' as const,
        yearsExperienceMin: null,
        remotePolicy: 'remote' as const,
        locationRestriction: null,
        matchScore: 70,
        matchReasons: [],
        gaps: [],
        redFlags: [],
      };
      await repo.saveExtraction(gh1.id, { ...extractionPayload, contentHash: gh1.contentHash });
      await repo.saveExtraction(gh2.id, { ...extractionPayload, contentHash: gh2.contentHash });
      await repo.saveExtraction(ashby1.id, { ...extractionPayload, contentHash: ashby1.contentHash });

      const stats = await repo.getStats();
      expect(stats.topSourceByMatches).toEqual({ source: 'greenhouse', count: 2 });
    });
  });
});
