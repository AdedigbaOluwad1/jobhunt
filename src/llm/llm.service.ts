import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { parse as parseDotenv } from 'dotenv';
import { z } from 'zod';
import { AppError } from '../common/errors';
import { envPath } from '../common/paths';

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

/**
 * Thin wrapper over the Anthropic SDK — the only place in the app that
 * imports it. Structured output is forced via a single-tool tool_choice;
 * the JSON schema handed to the API is derived straight from the same zod
 * schema used to validate the response, so there's one source of truth.
 */
@Injectable()
export class LlmService {
  private client?: Anthropic;

  async callStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
    const client = this.getClient();
    const { $schema: _drop, ...inputSchema } = z.toJSONSchema(input.schema) as Record<string, unknown>;

    const message = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 1536,
      system: input.system,
      messages: [{ role: 'user', content: input.user }],
      tools: [
        {
          name: input.toolName,
          description: input.toolDescription,
          input_schema: inputSchema as Anthropic.Tool.InputSchema,
          strict: true,
        },
      ],
      tool_choice: { type: 'tool', name: input.toolName },
      cache_control: { type: 'ephemeral' },
    });

    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use',
    );
    if (!toolUse) {
      throw new AppError('LLM_INVALID_OUTPUT', 'model did not return a tool call');
    }

    const parsed = input.schema.safeParse(toolUse.input);
    if (!parsed.success) {
      throw new LlmValidationError(parsed.error, toolUse.input);
    }

    return {
      data: parsed.data,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
    };
  }

  hasApiKey(): boolean {
    return this.resolveApiKey() !== undefined;
  }

  private getClient(): Anthropic {
    if (this.client) return this.client;
    this.client = new Anthropic({ apiKey: this.readApiKey() });
    return this.client;
  }

  private resolveApiKey(): string | undefined {
    if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
    if (fs.existsSync(envPath())) {
      const parsed = parseDotenv(fs.readFileSync(envPath()));
      if (parsed.ANTHROPIC_API_KEY) return parsed.ANTHROPIC_API_KEY;
    }
    return undefined;
  }

  private readApiKey(): string {
    const key = this.resolveApiKey();
    if (!key) {
      throw new AppError('CONFIG_MISSING', `ANTHROPIC_API_KEY not set. Add it to ${envPath()} or the environment.`);
    }
    return key;
  }
}
