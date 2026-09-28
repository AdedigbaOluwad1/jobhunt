import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { ConfigService } from '../config/config.service';
import { LlmProvider, LlmValidationError, ProviderName, StructuredCallInput, StructuredCallResult } from './provider.interface';

const DEFAULT_BASE_URL = 'http://localhost:11434';
const REQUEST_TIMEOUT_MS = 120_000;

interface OllamaChatResponse {
  message?: {
    tool_calls?: Array<{ function: { name: string; arguments: unknown } }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Talks to Ollama's native `/api/chat` rather than its OpenAI-compatible
 * `/v1/chat/completions` (see `openai-compatible.provider.ts` for that path,
 * used by `openai` and `local`) specifically to get `think: false`: verified
 * against a thinking-capable model that the OpenAI-compatible endpoint
 * ignores that setting and burns ~20x the output tokens on hidden reasoning,
 * while the native endpoint honors it and skips straight to the tool call.
 *
 * The native API has no `tool_choice` — it's not forced to call the one tool
 * offered, it just usually does when there's exactly one and the prompt asks
 * for it. A miss surfaces as the same "model did not return a tool call"
 * error the other providers raise, which the extractor/tailor call sites
 * already retry once with feedback.
 */
@Injectable()
export class OllamaProvider implements LlmProvider {
  readonly name: ProviderName = 'ollama';

  constructor(private readonly configService: ConfigService) {}

  async callStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
    const { $schema: _drop, ...parameters } = z.toJSONSchema(input.schema) as Record<string, unknown>;
    const settings = this.configService.load().llm.providers?.ollama;

    const res = await fetch(`${settings?.baseUrl ?? DEFAULT_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: input.model,
        stream: false,
        think: settings?.think ?? false,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        tools: [{ type: 'function', function: { name: input.toolName, description: input.toolDescription, parameters } }],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new AppError('LLM_INVALID_OUTPUT', `ollama returned HTTP ${res.status} for model "${input.model}": ${(await res.text()).slice(0, 500)}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    const toolCall = data.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new AppError('LLM_INVALID_OUTPUT', 'model did not return a tool call');
    }

    // The native endpoint returns arguments as a parsed object; the OpenAI-compatible
    // one (see the sibling provider) returns them JSON-encoded as a string. Handle both.
    const rawArgs = typeof toolCall.function.arguments === 'string' ? this.parseArguments(toolCall.function.arguments) : toolCall.function.arguments;

    const parsed = input.schema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new LlmValidationError(parsed.error, rawArgs);
    }

    return {
      data: parsed.data,
      usage: { inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 },
    };
  }

  isConfigured(): boolean {
    return true;
  }

  describeMissingConfig(): string {
    return 'unreachable — isConfigured() is always true for ollama, this should not be called';
  }

  private parseArguments(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new AppError('LLM_INVALID_OUTPUT', 'model returned malformed tool-call arguments (not valid JSON)');
    }
  }
}
