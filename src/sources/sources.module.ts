import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { GreenhouseSource } from './greenhouse.source';
import { SourcesService } from './sources.service';

@Module({
  imports: [ConfigModule],
  providers: [GreenhouseSource, SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
