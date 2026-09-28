import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { SourcesModule } from '../sources/sources.module';
import { FilterService } from './filter.service';
import { SyncService } from './sync.service';

@Module({
  imports: [ConfigModule, SourcesModule, DbModule],
  providers: [SyncService, FilterService],
  exports: [SyncService, FilterService],
})
export class JobsModule {}
