import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AshbySource } from './ashby.source';
import { GreenhouseSource } from './greenhouse.source';
import { LeverSource } from './lever.source';
import { SourcesService } from './sources.service';

@Module({
  imports: [ConfigModule],
  providers: [GreenhouseSource, LeverSource, AshbySource, SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
