import { Injectable, Logger } from '@nestjs/common';
import { withLimit } from '../common/limiter';
import { ConfigService } from '../config/config.service';
import { JobWithExtraction, JobsRepository } from '../db/jobs.repository';
import { LlmService, LlmValidationError, StructuredCallResult } from '../llm/llm.service';
import {
  buildExtractionSystemPrompt,
  buildExtractionUserMessage,
  EXTRACTION_PROMPT_VERSION,
  EXTRACTION_TOOL_DESCRIPTION,
  EXTRACTION_TOOL_NAME,
  ExtractionResult,
  ExtractionSchema,
} from './extraction.schema';

export interface ExtractionStats {
  attempted: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  /** Set instead of attempting anything when the API key isn't configured (spec 15: fail early, clearly). */
  skippedReason?: string;
}

const EMPTY_STATS: ExtractionStats = { attempted: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 };

@Injectable()
export class ExtractorService {
  private readonly logger = new Logger(ExtractorService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly jobsRepository: JobsRepository,
    private readonly llmService: LlmService,
  ) {}

  async extractDue(maxExtract: number): Promise<ExtractionStats> {
    const config = this.configService.load();
    const candidates = await this.jobsRepository.findJobsNeedingExtraction(EXTRACTION_PROMPT_VERSION, maxExtract);
    if (candidates.length === 0) {
      return { ...EMPTY_STATS };
    }

    if (!this.llmService.hasApiKey()) {
      return {
        ...EMPTY_STATS,
        skippedReason: `ANTHROPIC_API_KEY not set (${candidates.length} job(s) waiting for extraction)`,
      };
    }

    const limit = withLimit(config.llm.extractionConcurrency);
    const stats: ExtractionStats = { ...EMPTY_STATS };

    await Promise.all(
      candidates.map((job) =>
        limit(async () => {
          stats.attempted++;
          try {
            const result = await this.extractOne(job);
            stats.succeeded++;
            stats.inputTokens += result.usage.inputTokens;
            stats.outputTokens += result.usage.outputTokens;
          } catch (err) {
            stats.failed++;
            this.logger.warn(`extraction failed for job #${job.id}: ${err instanceof Error ? err.message : err}`);
          }
        }),
      ),
    );

    return stats;
  }

  private async extractOne(job: JobWithExtraction): Promise<StructuredCallResult<ExtractionResult>> {
    const config = this.configService.load();
    const system = buildExtractionSystemPrompt(config.profile);
    const user = buildExtractionUserMessage(job, config.llm.maxDescriptionChars);

    let result: StructuredCallResult<ExtractionResult>;
    try {
      result = await this.callModel(config.llm.extractionModel, system, user);
    } catch (err) {
      // Retry once with the validation error appended, per spec 10.2 — then let a
      // second failure propagate to the caller, which counts it and moves on.
      const feedback = this.describeFailureForRetry(err);
      result = await this.callModel(config.llm.extractionModel, system, `${user}\n\n${feedback}`);
    }

    await this.jobsRepository.saveExtraction(job.id, {
      contentHash: job.contentHash,
      promptVersion: EXTRACTION_PROMPT_VERSION,
      model: config.llm.extractionModel,
      ...result.data,
    });

    return result;
  }

  private callModel(model: string, system: string, user: string) {
    return this.llmService.callStructured({
      model,
      system,
      user,
      toolName: EXTRACTION_TOOL_NAME,
      toolDescription: EXTRACTION_TOOL_DESCRIPTION,
      schema: ExtractionSchema,
    });
  }

  private describeFailureForRetry(err: unknown): string {
    if (err instanceof LlmValidationError) {
      return `Your previous response failed validation: ${err.message}. Call ${EXTRACTION_TOOL_NAME} again, following the schema exactly this time.`;
    }
    return `Your previous response did not include a valid ${EXTRACTION_TOOL_NAME} tool call. Call it now with the required fields.`;
  }
}
