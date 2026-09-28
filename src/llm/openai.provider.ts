import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { ProviderName } from './provider.interface';

@Injectable()
export class OpenAiProvider extends OpenAiCompatibleProvider {
  readonly name: ProviderName = 'openai';
  protected readonly apiKeyEnvVar = 'OPENAI_API_KEY';
  protected readonly apiKeyRequired = true;
  protected readonly defaultBaseUrl = undefined;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  protected resolveBaseUrl(): string | undefined {
    return this.configService.load().llm.providers?.openai?.baseUrl;
  }
}
