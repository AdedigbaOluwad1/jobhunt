import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { ExtractorService } from './extractor.service';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';

@Module({
  imports: [ConfigModule, SourcesModule, DbModule, LlmModule],
  providers: [SyncService, FilterService, ExtractorService],
  exports: [SyncService, FilterService, ExtractorService],
})
export class JobsModule {}
