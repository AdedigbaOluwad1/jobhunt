import { JobsRepository } from '../src/db/jobs.repository';
import { PrismaService } from '../src/db/prisma.service';
import { ConfigService } from '../src/config/config.service';
import { MasterCv } from '../src/cv/cv.schema';
import { MasterCvService } from '../src/cv/master-cv.service';
import { RenderService } from '../src/cv/render.service';
import { TailorService } from '../src/cv/tailor.service';
import { EXTRACTION_TOOL_NAME } from '../src/jobs/extraction.schema';
import { ExtractorService } from '../src/jobs/extractor.service';
import { LlmService, StructuredCallInput } from '../src/llm/llm.service';
import { TAILOR_TOOL_NAME, TailoredCv } from '../src/cv/tailor.schema';
import { normalize } from '../src/jobs/normalize';
import { RawJob } from '../src/sources/source.interface';
import { makeTestConfig } from './helpers/fake-config';
import { createTempHome } from './helpers/temp-home';
import sampleExtraction from './fixtures/extraction-sample.json';

function makeMasterCv(bulletsPerRole = 2): MasterCv {
  return {
    basics: { name: 'Jane Doe', email: 'jane@example.com', phone: '+1', location: 'Remote', links: [] },
    summary: 'Default backend engineer summary.',
    skills: [{ group: 'Backend', items: ['TypeScript', 'NestJS', 'PostgreSQL'] }],
    experience: [
      {
        id: 'exp-1',
        company: 'Acme Ltd',
        title: 'Senior Backend Engineer',
        location: 'Remote',
        start: '2020-01',
        end: null,
        bullets: Array.from({ length: bulletsPerRole }, (_, i) => ({
          id: `exp-1-${i}`,
          text: `Owned backend initiative ${i}, improving reliability across the team over multiple quarters and releases.`,
          tags: [],
        })),
      },
    ],
    projects: [],
    education: [{ id: 'edu-1', institution: 'State University', degree: 'B.Sc. CS', start: '2016', end: '2020' }],
  };
}

function makeGoodTailoredCv(masterCv: MasterCv): TailoredCv {
  return {
    summary: masterCv.summary,
    skillGroups: masterCv.skills,
    experience: [{ id: 'exp-1', bullets: masterCv.experience[0].bullets.map((b) => ({ id: b.id, text: b.text })) }],
    projects: [],
    requirementMap: [{ requirement: 'backend experience', evidenceBulletIds: [masterCv.experience[0].bullets[0].id] }],
  };
}

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'greenhouse',
    board: 'acme',
    externalId: '1',
    company: 'Target Co',
    title: 'Backend Engineer',
    location: 'Remote',
    url: 'https://example.com/jobs/1',
    descriptionText: 'Build backend systems with TypeScript and PostgreSQL.',
    ...overrides,
  };
}

describe('TailorService', () => {
  let cleanup: () => void;
  let jobsRepository: JobsRepository;
  let configService: ConfigService;
  let masterCvService: MasterCvService;
  let masterCv: MasterCv;
  let renderService: RenderService;

  beforeEach(async () => {
    ({ cleanup } = await createTempHome());
    jobsRepository = new JobsRepository(new PrismaService());
    configService = { load: () => makeTestConfig() } as unknown as ConfigService;
    masterCv = makeMasterCv();
    masterCvService = { load: () => masterCv } as unknown as MasterCvService;
    renderService = new RenderService();
  });

  afterEach(async () => {
    await renderService.onModuleDestroy();
    cleanup();
  });

  async function insertPassedJob(overrides: Partial<RawJob> = {}) {
    const normalized = normalize(rawJob(overrides));
    const { job } = await jobsRepository.upsertJob(normalized, { status: 'passed', reason: null });
    return job;
  }

  function makeTailorService(callStructured: jest.Mock): TailorService {
    const llmService = { isConfigured: () => true, describeMissingConfig: () => 'ANTHROPIC_API_KEY not set', callStructured } as unknown as LlmService;
    const extractorService = new ExtractorService(configService, jobsRepository, llmService);
    return new TailorService(configService, jobsRepository, masterCvService, extractorService, llmService, renderService);
  }

  function routingMock(tailoredCv: TailoredCv): jest.Mock {
    return jest.fn(async (input: StructuredCallInput<unknown>) => {
      if (input.toolName === EXTRACTION_TOOL_NAME) return { data: sampleExtraction, usage: { inputTokens: 10, outputTokens: 5 } };
      if (input.toolName === TAILOR_TOOL_NAME) return { data: tailoredCv, usage: { inputTokens: 10, outputTokens: 5 } };
      throw new Error(`unexpected tool: ${input.toolName}`);
    });
  }

  it('runs extraction on demand, then tailors and renders a real PDF', async () => {
    const job = await insertPassedJob();
    const callStructured = routingMock(makeGoodTailoredCv(masterCv));
    const tailorService = makeTailorService(callStructured);

    const result = await tailorService.tailorAndRender(job.id);

    expect(result.reused).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(callStructured).toHaveBeenCalledWith(expect.objectContaining({ toolName: EXTRACTION_TOOL_NAME }));
    expect(callStructured).toHaveBeenCalledWith(expect.objectContaining({ toolName: TAILOR_TOOL_NAME }));

    const refreshed = await jobsRepository.findById(job.id);
    expect(refreshed?.extraction).not.toBeNull();

    const application = await jobsRepository.findApplicationByJobId(job.id);
    expect(application?.cvPdfPath).toBe(result.cvPdfPath);
  }, 20_000);

  it('reuses an existing application without calling the LLM again', async () => {
    const job = await insertPassedJob();
    const first = routingMock(makeGoodTailoredCv(masterCv));
    await makeTailorService(first).tailorAndRender(job.id);

    const second = routingMock(makeGoodTailoredCv(masterCv));
    const result = await makeTailorService(second).tailorAndRender(job.id);

    expect(result.reused).toBe(true);
    expect(second).not.toHaveBeenCalled();
  }, 20_000);

  it('re-tailors when --regen is passed even with an existing application', async () => {
    const job = await insertPassedJob();
    const first = routingMock(makeGoodTailoredCv(masterCv));
    await makeTailorService(first).tailorAndRender(job.id);

    const second = routingMock(makeGoodTailoredCv(masterCv));
    const result = await makeTailorService(second).tailorAndRender(job.id, { regen: true });

    expect(result.reused).toBe(false);
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ toolName: TAILOR_TOOL_NAME }));
  }, 20_000);

  it('falls back a fabricated bullet to the original master text and renders that instead', async () => {
    const job = await insertPassedJob();
    const badCv = makeGoodTailoredCv(masterCv);
    badCv.experience[0].bullets[0] = { id: masterCv.experience[0].bullets[0].id, text: `${masterCv.experience[0].bullets[0].text} Grew revenue by 300%.` };
    // Every retry returns the same fabricated bullet, forcing the fallback path.
    const callStructured = jest.fn(async (input: StructuredCallInput<unknown>) => {
      if (input.toolName === EXTRACTION_TOOL_NAME) return { data: sampleExtraction, usage: { inputTokens: 10, outputTokens: 5 } };
      return { data: badCv, usage: { inputTokens: 10, outputTokens: 5 } };
    });
    const tailorService = makeTailorService(callStructured);

    const result = await tailorService.tailorAndRender(job.id);

    expect(result.warnings.some((w) => w.includes('300%'))).toBe(true);
    expect(result.tailoredCv.experience[0].bullets[0].text).toBe(masterCv.experience[0].bullets[0].text);
    // called twice for tailoring (initial + one semantic retry), once for extraction
    expect(callStructured.mock.calls.filter((c) => c[0].toolName === TAILOR_TOOL_NAME)).toHaveLength(2);
  }, 20_000);

  it('drops bullets until the PDF fits within cv.maxPages', async () => {
    masterCv = makeMasterCv(60);
    masterCvService = { load: () => masterCv } as unknown as MasterCvService;
    configService = { load: () => makeTestConfig({ cv: { ...makeTestConfig().cv, maxPages: 1 } }) } as unknown as ConfigService;

    const job = await insertPassedJob();
    const callStructured = routingMock(makeGoodTailoredCv(masterCv));
    const tailorService = makeTailorService(callStructured);

    const result = await tailorService.tailorAndRender(job.id);

    expect(result.pages).toBe(1);
    expect(result.tailoredCv.experience[0].bullets.length).toBeLessThan(60);
  }, 20_000);
});
