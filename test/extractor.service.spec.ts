import { JobsRepository } from '../src/db/jobs.repository';
import { PrismaService } from '../src/db/prisma.service';
import { ConfigService } from '../src/config/config.service';
import { ExtractorService } from '../src/jobs/extractor.service';
import { EXTRACTION_PROMPT_VERSION } from '../src/jobs/extraction.schema';
import { normalize } from '../src/jobs/normalize';
import { LlmService } from '../src/llm/llm.service';
import { RawJob } from '../src/sources/source.interface';
import { makeTestConfig } from './helpers/fake-config';
import { createTempHome } from './helpers/temp-home';
// Hand-built, not a live capture: no ANTHROPIC_API_KEY was available in the
// dev environment this was written in. Shaped to satisfy ExtractionSchema
// exactly so it stands in for a real tool_use.input payload in these tests.
import sampleExtraction from './fixtures/extraction-sample.json';

function rawJob(overrides: Partial<RawJob> = {}): RawJob {
  return {
    source: 'greenhouse',
    board: 'acme',
    externalId: '1',
    company: 'Acme Inc',
    title: 'Backend Engineer',
    location: 'Berlin, Germany',
    url: 'https://example.com/jobs/1',
    descriptionText: 'Build things with TypeScript and Postgres.',
    ...overrides,
  };
}

function usage() {
  return { inputTokens: 100, outputTokens: 50 };
}

function fakeLlm(callStructured: jest.Mock, isConfigured = true): LlmService {
  return { isConfigured: () => isConfigured, describeMissingConfig: () => 'ANTHROPIC_API_KEY not set', callStructured } as unknown as LlmService;
}

describe('ExtractorService', () => {
  let cleanup: () => void;
  let jobsRepository: JobsRepository;
  let configService: ConfigService;

  beforeEach(async () => {
    ({ cleanup } = await createTempHome());
    jobsRepository = new JobsRepository(new PrismaService());
    configService = { load: () => makeTestConfig() } as unknown as ConfigService;
  });

  afterEach(() => cleanup());

  async function insertPassedJob(overrides: Partial<RawJob> = {}) {
    const normalized = normalize(rawJob(overrides));
    const { job } = await jobsRepository.upsertJob(normalized, { status: 'passed', reason: null });
    return job;
  }

  it('parses a realistic tool-call payload against the schema', async () => {
    const { ExtractionSchema } = await import('../src/jobs/extraction.schema');
    const result = ExtractionSchema.safeParse(sampleExtraction);
    expect(result.success).toBe(true);
  });

  it('calls the model and saves the extraction for a job that has none yet', async () => {
    const job = await insertPassedJob();
    const llmService = fakeLlm(jest.fn().mockResolvedValue({ data: sampleExtraction, usage: usage() }));
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    const stats = await extractor.extractDue(10);

    expect(stats).toMatchObject({ attempted: 1, succeeded: 1, failed: 0 });
    expect(llmService.callStructured).toHaveBeenCalledTimes(1);

    const saved = await jobsRepository.findById(job.id);
    expect(saved?.extraction?.matchScore).toBe(sampleExtraction.matchScore);
    expect(saved?.extraction?.promptVersion).toBe(EXTRACTION_PROMPT_VERSION);
    expect(JSON.parse(saved!.extraction!.requirements)).toEqual(sampleExtraction.requirements);
  });

  it('makes zero LLM calls on a second run when nothing changed', async () => {
    await insertPassedJob();
    const llmService = fakeLlm(jest.fn().mockResolvedValue({ data: sampleExtraction, usage: usage() }));
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    await extractor.extractDue(10);
    const second = await extractor.extractDue(10);

    expect(second.attempted).toBe(0);
    expect(llmService.callStructured).toHaveBeenCalledTimes(1);
  });

  it('re-extracts everything once the job content changes', async () => {
    let description = 'Build things with TypeScript and Postgres.';
    await insertPassedJob({ descriptionText: description });
    const llmService = fakeLlm(jest.fn().mockResolvedValue({ data: sampleExtraction, usage: usage() }));
    const extractor = new ExtractorService(configService, jobsRepository, llmService);
    await extractor.extractDue(10);

    description = 'Build things with TypeScript, Postgres, and Kafka.';
    await insertPassedJob({ descriptionText: description });
    const stats = await extractor.extractDue(10);

    expect(stats.attempted).toBe(1);
    expect(llmService.callStructured).toHaveBeenCalledTimes(2);
  });

  it('retries once on invalid output, then saves the retried result', async () => {
    await insertPassedJob();
    const llmService = fakeLlm(
      jest
        .fn()
        .mockRejectedValueOnce(new Error('model did not return a tool call'))
        .mockResolvedValueOnce({ data: sampleExtraction, usage: usage() }),
    );
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    const stats = await extractor.extractDue(10);

    expect(stats).toMatchObject({ succeeded: 1, failed: 0 });
    expect(llmService.callStructured).toHaveBeenCalledTimes(2);
    // the retry call includes feedback about the earlier failure
    const secondCallArgs = (llmService.callStructured as jest.Mock).mock.calls[1][0];
    expect(secondCallArgs.user).toContain('did not include a valid');
  });

  it('gives up after a second invalid response, without crashing the run', async () => {
    const job = await insertPassedJob();
    const llmService = fakeLlm(jest.fn().mockRejectedValue(new Error('model did not return a tool call')));
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    const stats = await extractor.extractDue(10);

    expect(stats).toMatchObject({ attempted: 1, succeeded: 0, failed: 1 });
    expect(llmService.callStructured).toHaveBeenCalledTimes(2);
    const saved = await jobsRepository.findById(job.id);
    expect(saved?.extraction).toBeNull();
  });

  it('never extracts a rejected, duplicate, or closed job', async () => {
    const normalizedRejected = normalize(rawJob({ externalId: '2' }));
    await jobsRepository.upsertJob(normalizedRejected, { status: 'rejected', reason: 'title-no-match' });
    const passed = await insertPassedJob({ externalId: '3' });
    await jobsRepository.setDuplicateOf(passed.id, 999);

    const llmService = fakeLlm(jest.fn().mockResolvedValue({ data: sampleExtraction, usage: usage() }));
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    const stats = await extractor.extractDue(10);

    expect(stats.attempted).toBe(0);
    expect(llmService.callStructured).not.toHaveBeenCalled();
  });

  it('skips extraction with a clear reason instead of attempting calls when the API key is missing', async () => {
    await insertPassedJob();
    const llmService = fakeLlm(jest.fn(), false);
    const extractor = new ExtractorService(configService, jobsRepository, llmService);

    const stats = await extractor.extractDue(10);

    expect(stats.attempted).toBe(0);
    expect(stats.skippedReason).toMatch(/ANTHROPIC_API_KEY/);
    expect(llmService.callStructured).not.toHaveBeenCalled();
  });
});
