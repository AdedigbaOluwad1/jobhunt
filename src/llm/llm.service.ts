import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { AnthropicProvider } from './anthropic.provider';
import { CloudflareProvider } from './cloudflare.provider';
import { LocalProvider } from './local.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenAiProvider } from './openai.provider';
import { LlmProvider, PROVIDER_NAMES, ProviderName, StructuredCallInput, StructuredCallResult } from './provider.interface';

export { LlmValidationError, StructuredCallInput, StructuredCallResult } from './provider.interface';

interface ParsedModel {
  provider: ProviderName;
  model: string;
}

/**
 * Routes a "<provider>/<model>" id (e.g. `anthropic/claude-haiku-4-5-20251001`,
 * `openai/gpt-4o-mini`, `local/llama3.1`) to the matching provider adapter.
 * This is the only place in the app that knows the provider list.
 */
@Injectable()
export class LlmService {
  private readonly providers: Record<ProviderName, LlmProvider>;

  constructor(anthropic: AnthropicProvider, openai: OpenAiProvider, local: LocalProvider, ollama: OllamaProvider, cloudflare: CloudflareProvider) {
    this.providers = { anthropic, openai, local, ollama, cloudflare };
  }

  callStructured<T>(input: StructuredCallInput<T>): Promise<StructuredCallResult<T>> {
    const { provider, model } = this.parseModelId(input.model);
    return this.providers[provider].callStructured({ ...input, model });
  }

  isConfigured(modelId: string): boolean {
    return this.providers[this.parseModelId(modelId).provider].isConfigured();
  }

  describeMissingConfig(modelId: string): string {
    return this.providers[this.parseModelId(modelId).provider].describeMissingConfig();
  }

  private parseModelId(modelId: string): ParsedModel {
    const separatorIndex = modelId.indexOf('/');
    if (separatorIndex <= 0) {
      throw new AppError(
        'CONFIG_INVALID',
        `model "${modelId}" must be of the form "<provider>/<model>" (e.g. "anthropic/claude-haiku-4-5-20251001"). Supported providers: ${PROVIDER_NAMES.join(', ')}.`,
      );
    }
    const provider = modelId.slice(0, separatorIndex);
    const model = modelId.slice(separatorIndex + 1);
    if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
      throw new AppError('CONFIG_INVALID', `unknown LLM provider "${provider}" in model "${modelId}". Supported providers: ${PROVIDER_NAMES.join(', ')}.`);
    }
    return { provider: provider as ProviderName, model };
  }
}
