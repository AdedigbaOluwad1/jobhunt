import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { ProviderName } from './provider.interface';

/** Targets an open-weight model served locally through an OpenAI-compatible endpoint — Ollama by default, or LM Studio/vLLM/llama.cpp server via `llm.providers.local.baseUrl`. No API key is required. */
@Injectable()
export class LocalProvider extends OpenAiCompatibleProvider {
  readonly name: ProviderName = 'local';
  protected readonly apiKeyEnvVar = 'LOCAL_LLM_API_KEY';
  protected readonly apiKeyRequired = false;
  protected readonly defaultBaseUrl = 'http://localhost:11434/v1';

  constructor(private readonly configService: ConfigService) {
    super();
  }

  protected resolveBaseUrl(): string | undefined {
    return this.configService.load().llm.providers?.local?.baseUrl;
  }
}
