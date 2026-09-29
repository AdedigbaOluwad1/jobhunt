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

const ProviderOverrideSchema = z
  .object({
    /** Overrides the provider's default API base URL, e.g. to point "local" at LM Studio or vLLM instead of Ollama. */
    baseUrl: z.string().optional(),
  })
  .strict();

const CloudflareProviderOverrideSchema = z
  .object({
    /** Cloudflare account ID; the Workers AI base URL is derived from it. */
    accountId: z.string().optional(),
    /** Overrides the derived base URL, e.g. to route through AI Gateway. */
    baseUrl: z.string().optional(),
  })
  .strict();

const OllamaProviderOverrideSchema = z
  .object({
    baseUrl: z.string().optional(),
    /** Passed as Ollama's native `think` option. Defaults to false: for structured extraction/tailoring, hidden reasoning only adds latency and token cost. */
    think: z.boolean().optional(),
  })
  .strict();

const LlmSchema = z
  .object({
    // "<provider>/<model>", e.g. "anthropic/claude-haiku-4-5-20251001", "openai/gpt-4o-mini",
    // "local/llama3.1" (any OpenAI-compatible local server), "ollama/qwen3.6:latest" (Ollama's native API), "cloudflare/@cf/meta/llama-3.3-70b-instruct-fp8-fast".
    extractionModel: z.string(),
    tailorModel: z.string(),
    maxDescriptionChars: z.number().int().positive(),
    extractionConcurrency: z.number().int().positive(),
    providers: z
      .object({
        openai: ProviderOverrideSchema.optional(),
        local: ProviderOverrideSchema.optional(),
        ollama: OllamaProviderOverrideSchema.optional(),
        cloudflare: CloudflareProviderOverrideSchema.optional(),
      })
      .strict()
      .optional(),
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
