import { z } from 'zod';

export type ProviderName = 'anthropic' | 'openai' | 'local' | 'ollama' | 'cloudflare';

export const PROVIDER_NAMES: readonly ProviderName[] = ['anthropic', 'openai', 'local', 'ollama', 'cloudflare'];

export class LlmValidationError extends Error {
  constructor(
    public readonly zodError: z.ZodError,
    public readonly rawInput: unknown,
  ) {
    super(`model output failed schema validation: ${zodError.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    this.name = 'LlmValidationError';
  }
}

export interface StructuredCallInput<T> {
  /** Bare model id, without the "<provider>/" prefix — the provider already knows which API it is calling. */
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export interface StructuredCallResult<T> {
  data: T;
  usage: { inputTokens: number; outputTokens: number };
}

/** One adapter per LLM backend, following the same pattern as the source adapters in `../sources`. */
export interface LlmProvider {
  readonly name: ProviderName;
  callStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>>;
  /** Whether this provider has everything it needs (e.g. an API key) to be called. */
  isConfigured(): boolean;
  /** Human-readable reason `isConfigured()` is false, for skip/error messages. */
  describeMissingConfig(): string;
}
