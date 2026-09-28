import { z } from 'zod';

const ProfileSchema = z
  .object({
    summary: z.string(),
    yearsExperience: z.number().int().min(0),
    targetTitles: z.array(z.string()),
    mustHaveSkills: z.array(z.string()),
    dealbreakers: z.array(z.string()),
  })
  .strict();

const RemotiveSchema = z
  .object({
    enabled: z.boolean(),
    categories: z.array(z.string()).optional(),
    minIntervalHours: z.number().int().min(0).default(12),
  })
  .strict();

const RemoteOkSchema = z
  .object({
    enabled: z.boolean(),
    minIntervalHours: z.number().int().min(0).default(12),
  })
  .strict();

const WwrSchema = z
  .object({
    enabled: z.boolean(),
    feeds: z.array(z.string()).optional(),
    minIntervalHours: z.number().int().min(0).default(12),
  })
  .strict();

const SourcesSchema = z
  .object({
    greenhouse: z.array(z.string()).default([]),
    lever: z.array(z.string()).default([]),
    lever_eu: z.array(z.string()).default([]),
    ashby: z.array(z.string()).default([]),
    companyNames: z.record(z.string(), z.string()).optional(),
    remote: z
      .object({
        remotive: RemotiveSchema.optional(),
        remoteok: RemoteOkSchema.optional(),
        wwr: WwrSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const FiltersSchema = z
  .object({
    titleInclude: z.array(z.string()),
    titleExclude: z.array(z.string()),
    remoteOnly: z.boolean(),
    locationsAllow: z.array(z.string()),
    descriptionExclude: z.array(z.string()),
    maxAgeDays: z.number().int().positive(),
  })
  .strict();

const LlmSchema = z
  .object({
    extractionModel: z.string(),
    tailorModel: z.string(),
    maxDescriptionChars: z.number().int().positive(),
    extractionConcurrency: z.number().int().positive(),
  })
  .strict();

const SyncSchema = z
  .object({
    httpConcurrency: z.number().int().positive(),
    httpTimeoutMs: z.number().int().positive(),
    httpRetries: z.number().int().min(0),
    maxExtractPerRun: z.number().int().positive(),
    minScoreToHighlight: z.number().int().min(0).max(100),
  })
  .strict();

const CvSchema = z
  .object({
    maxPages: z.number().int().positive(),
    maxBulletsPerRole: z.number().int().positive(),
    paper: z.enum(['A4', 'Letter']),
  })
  .strict();

export const ConfigSchema = z
  .object({
    profile: ProfileSchema,
    sources: SourcesSchema,
    filters: FiltersSchema,
    llm: LlmSchema,
    sync: SyncSchema,
    cv: CvSchema,
  })
  .strict();

export type AppConfig = z.infer<typeof ConfigSchema>;

export function formatConfigError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => `  ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  return `config.yaml is invalid:\n${lines.join('\n')}`;
}
