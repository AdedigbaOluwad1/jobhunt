import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AnthropicProvider } from './anthropic.provider';
import { LlmService } from './llm.service';
import { LocalProvider } from './local.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenAiProvider } from './openai.provider';

@Module({
  imports: [ConfigModule],
  providers: [AnthropicProvider, OpenAiProvider, LocalProvider, OllamaProvider, LlmService],
  exports: [LlmService],
})
export class LlmModule {}
