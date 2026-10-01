import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { LlmModule } from '../llm/llm.module';
import { SourcesModule } from '../sources/sources.module';
import { ExtractorService } from './extractor.service';
import { FilterService } from './filter.service';
import { ManualJobService } from './manual-job.service';
import { SyncService } from './sync.service';

@Module({
  imports: [ConfigModule, SourcesModule, DbModule, LlmModule],
  providers: [SyncService, FilterService, ExtractorService, ManualJobService],
  exports: [SyncService, FilterService, ExtractorService, ManualJobService],
})
export class JobsModule {}
