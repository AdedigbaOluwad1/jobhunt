import { Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { ConfigService } from '../config/config.service';
import { OpenAiCompatibleProvider } from './openai-compatible.provider';
import { ProviderName } from './provider.interface';

/** Cloudflare Workers AI through its OpenAI-compatible endpoint. The base URL is account-scoped, so it is built from `llm.providers.cloudflare.accountId` unless `baseUrl` overrides it. */
@Injectable()
export class CloudflareProvider extends OpenAiCompatibleProvider {
  readonly name: ProviderName = 'cloudflare';
  protected readonly apiKeyEnvVar = 'CLOUDFLARE_API_TOKEN';
  protected readonly apiKeyRequired = true;
  protected readonly defaultBaseUrl = undefined;

  constructor(private readonly configService: ConfigService) {
    super();
  }

  isConfigured(): boolean {
    return super.isConfigured() && this.baseUrlFromConfig() !== undefined;
  }

  describeMissingConfig(): string {
    if (!super.isConfigured()) return super.describeMissingConfig();
    return 'llm.providers.cloudflare.accountId is not set in config.yaml.';
  }

  protected resolveBaseUrl(): string {
    const baseUrl = this.baseUrlFromConfig();
    if (!baseUrl) throw new AppError('CONFIG_MISSING', this.describeMissingConfig());
    return baseUrl;
  }

  private baseUrlFromConfig(): string | undefined {
    const cfg = this.configService.load().llm.providers?.cloudflare;
    if (cfg?.baseUrl) return cfg.baseUrl;
    if (cfg?.accountId) return `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/ai/v1`;
    return undefined;
  }
}
