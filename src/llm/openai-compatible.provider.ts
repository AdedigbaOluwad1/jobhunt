import * as fs from 'node:fs';
import OpenAI from 'openai';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { envPath } from '../common/paths';
import { LlmProvider, LlmValidationError, ProviderName, StructuredCallInput, StructuredCallResult } from './provider.interface';

/**
 * Base for any backend that speaks the OpenAI chat-completions API — OpenAI
 * itself, and the OpenAI-compatible endpoint every popular local-model
 * runtime (Ollama, LM Studio, vLLM, llama.cpp server) exposes. Structured
 * output uses the same forced single-tool-call approach as the Anthropic
 * provider, via `tool_choice`.
 */
export abstract class OpenAiCompatibleProvider implements LlmProvider {
  abstract readonly name: ProviderName;
  protected abstract readonly apiKeyEnvVar: string;
  protected abstract readonly apiKeyRequired: boolean;
  /** Used when config doesn't override the base URL; `undefined` means the SDK's own default (OpenAI's API). */
  protected abstract readonly defaultBaseUrl: string | undefined;

  private client?: OpenAI;

  /** Config-file override for the base URL, e.g. `llm.providers.local.baseUrl`. */
  protected abstract resolveBaseUrl(): string | undefined;

  async callStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
    const client = this.getClient();
    const { $schema: _drop, ...parameters } = z.toJSONSchema(input.schema) as Record<string, unknown>;

    const completion = await client.chat.completions.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 1536,
      messages: [
        { role: 'system', content: input.system },
        { role: 'user', content: input.user },
      ],
      tools: [{ type: 'function', function: { name: input.toolName, description: input.toolDescription, parameters } }],
      tool_choice: { type: 'function', function: { name: input.toolName } },
    });

    const choice = completion.choices[0];
    const toolCall = choice?.message.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') {
      // Models that ignore a forced tool_choice reply in prose; the reply shows why.
      const reply = (choice?.message.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new AppError(
        'LLM_INVALID_OUTPUT',
        `model did not return a tool call (finish_reason: ${choice?.finish_reason ?? 'none'}, reply: ${reply ? `"${reply}"` : 'empty'})`,
      );
    }

    let rawArgs: unknown;
    try {
      rawArgs = JSON.parse(toolCall.function.arguments);
    } catch {
      throw new AppError('LLM_INVALID_OUTPUT', 'model returned malformed tool-call arguments (not valid JSON)');
    }

    const parsed = input.schema.safeParse(rawArgs);
    if (!parsed.success) {
      throw new LlmValidationError(parsed.error, rawArgs);
    }

    return {
      data: parsed.data,
      usage: {
        inputTokens: completion.usage?.prompt_tokens ?? 0,
        outputTokens: completion.usage?.completion_tokens ?? 0,
      },
    };
  }

  isConfigured(): boolean {
    return !this.apiKeyRequired || this.resolveApiKey() !== undefined;
  }

  describeMissingConfig(): string {
    return `${this.apiKeyEnvVar} not set. Add it to ${envPath()} or the environment.`;
  }

  private getClient(): OpenAI {
    if (this.client) return this.client;
    const apiKey = this.resolveApiKey();
    if (this.apiKeyRequired && !apiKey) {
      throw new AppError('CONFIG_MISSING', this.describeMissingConfig());
    }
    this.client = new OpenAI({
      apiKey: apiKey ?? 'not-required',
      baseURL: this.resolveBaseUrl() ?? this.defaultBaseUrl,
    });
    return this.client;
  }

  private resolveApiKey(): string | undefined {
    if (process.env[this.apiKeyEnvVar]) return process.env[this.apiKeyEnvVar];
    if (fs.existsSync(envPath())) {
      const parsed = parseDotenv(fs.readFileSync(envPath()));
      if (parsed[this.apiKeyEnvVar]) return parsed[this.apiKeyEnvVar];
    }
    return undefined;
  }
}
