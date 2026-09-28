import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AshbySource } from './ashby.source';
import { GreenhouseSource } from './greenhouse.source';
import { LeverSource } from './lever.source';
import { RemoteOkSource } from './remoteok.source';
import { RemotiveSource } from './remotive.source';
import { SourcesService } from './sources.service';
import { WwrSource } from './wwr.source';

@Module({
  imports: [ConfigModule],
  providers: [GreenhouseSource, LeverSource, AshbySource, RemotiveSource, RemoteOkSource, WwrSource, SourcesService],
  exports: [SourcesService],
})
export class SourcesModule {}
