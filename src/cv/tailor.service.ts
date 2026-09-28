import * as fs from 'node:fs';
import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { outDir } from '../common/paths';
import { slugify } from '../common/text';
import { ConfigService } from '../config/config.service';
import { JobWithExtraction, JobsRepository } from '../db/jobs.repository';
import { ExtractorService } from '../jobs/extractor.service';
import { LlmService, LlmValidationError } from '../llm/llm.service';
import { MasterCv } from './cv.schema';
import { renderCvHtml } from './cv-template';
import { MasterCvService } from './master-cv.service';
import { RenderService } from './render.service';
import { buildTailorSystemPrompt, buildTailorUserMessage, TAILOR_TOOL_DESCRIPTION, TAILOR_TOOL_NAME, TailoredCv, TailoredCvSchema } from './tailor.schema';
import { applyFallbacks, validateTailoredCv } from './tailor.validator';

export interface TailorResult {
  reused: boolean;
  cvPdfPath: string;
  tailoredCv: TailoredCv;
  warnings: string[];
  pages?: number;
}

function dropLowestRelevanceBullet(cv: TailoredCv): boolean {
  const roles = [...cv.experience, ...cv.projects];
  for (let i = roles.length - 1; i >= 0; i--) {
    if (roles[i].bullets.length > 0) {
      roles[i].bullets.pop();
      return true;
    }
  }
  return false;
}

@Injectable()
export class TailorService {
  constructor(
    private readonly configService: ConfigService,
    private readonly jobsRepository: JobsRepository,
    private readonly masterCvService: MasterCvService,
    private readonly extractorService: ExtractorService,
    private readonly llmService: LlmService,
    private readonly renderService: RenderService,
  ) {}

  async tailorAndRender(jobId: number, options: { regen?: boolean } = {}): Promise<TailorResult> {
    if (!options.regen) {
      const existing = await this.jobsRepository.findApplicationByJobId(jobId);
      if (existing) {
        return { reused: true, cvPdfPath: existing.cvPdfPath, tailoredCv: JSON.parse(existing.tailoredJson), warnings: [] };
      }
    }

    const job = await this.extractorService.ensureExtraction(jobId);
    const masterCv = this.masterCvService.load();
    const config = this.configService.load();

    const { tailoredCv, warnings } = await this.generateTailoredCv(job, masterCv, config.llm.tailorModel, config.cv.maxBulletsPerRole);

    let pdf = await this.renderService.renderPdf(renderCvHtml(masterCv, tailoredCv), config.cv.paper);
    let pages = this.renderService.countPages(pdf);
    while (pages > config.cv.maxPages && dropLowestRelevanceBullet(tailoredCv)) {
      pdf = await this.renderService.renderPdf(renderCvHtml(masterCv, tailoredCv), config.cv.paper);
      pages = this.renderService.countPages(pdf);
    }

    const outDirPath = outDir();
    fs.mkdirSync(outDirPath, { recursive: true });
    const basename = `${slugify(job.company)}-${slugify(job.title)}-${job.id}`;
    const cvPdfPath = path.join(outDirPath, `${basename}.pdf`);
    const cvJsonPath = path.join(outDirPath, `${basename}.json`);
    fs.writeFileSync(cvPdfPath, pdf);
    fs.writeFileSync(cvJsonPath, JSON.stringify(tailoredCv, null, 2));

    await this.jobsRepository.createApplication({ jobId, cvPdfPath, tailoredJson: JSON.stringify(tailoredCv) });

    return { reused: false, cvPdfPath, tailoredCv, warnings, pages };
  }

  private async generateTailoredCv(
    job: JobWithExtraction,
    masterCv: MasterCv,
    model: string,
    maxBulletsPerRole: number,
  ): Promise<{ tailoredCv: TailoredCv; warnings: string[] }> {
    const extraction = this.parseExtraction(job);
    const system = buildTailorSystemPrompt(maxBulletsPerRole);
    const baseUser = buildTailorUserMessage({ company: job.company, title: job.title }, extraction, masterCv);

    let tailoredCv = await this.callTailorModel(model, system, baseUser);
    let violations = validateTailoredCv(tailoredCv, masterCv);

    if (violations.length > 0) {
      const feedback = `Your previous response had these problems — fix them and call ${TAILOR_TOOL_NAME} again:\n${violations.map((v) => `- ${v.message}`).join('\n')}`;
      tailoredCv = await this.callTailorModel(model, system, `${baseUser}\n\n${feedback}`);
      violations = validateTailoredCv(tailoredCv, masterCv);
    }

    const warnings = violations.map((v) => v.message);
    const finalCv = violations.length > 0 ? applyFallbacks(tailoredCv, masterCv, violations) : tailoredCv;
    return { tailoredCv: finalCv, warnings };
  }

  /** Structural (schema) retry — separate from the semantic anti-fabrication retry in generateTailoredCv. */
  private async callTailorModel(model: string, system: string, user: string): Promise<TailoredCv> {
    try {
      const result = await this.llmService.callStructured({
        model,
        system,
        user,
        toolName: TAILOR_TOOL_NAME,
        toolDescription: TAILOR_TOOL_DESCRIPTION,
        schema: TailoredCvSchema,
        maxTokens: 4096,
      });
      return result.data;
    } catch (err) {
      const feedback =
        err instanceof LlmValidationError
          ? `Your previous response failed validation: ${err.message}. Call ${TAILOR_TOOL_NAME} again, following the schema exactly this time.`
          : `Your previous response did not include a valid ${TAILOR_TOOL_NAME} tool call. Call it now with the required fields.`;
      const retry = await this.llmService.callStructured({
        model,
        system,
        user: `${user}\n\n${feedback}`,
        toolName: TAILOR_TOOL_NAME,
        toolDescription: TAILOR_TOOL_DESCRIPTION,
        schema: TailoredCvSchema,
        maxTokens: 4096,
      });
      return retry.data;
    }
  }

  private parseExtraction(job: JobWithExtraction): { requirements: string[]; niceToHave: string[]; stack: string[]; seniority: string } | null {
    if (!job.extraction) return null;
    return {
      requirements: JSON.parse(job.extraction.requirements),
      niceToHave: JSON.parse(job.extraction.niceToHave),
      stack: JSON.parse(job.extraction.stack),
      seniority: job.extraction.seniority,
    };
  }
}
