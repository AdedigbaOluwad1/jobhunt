import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { AshbySource } from './ashby.source';
import { GreenhouseSource } from './greenhouse.source';
import { LeverSource } from './lever.source';
import { WorkableSource } from './workable.source';
import { RecruiteeSource } from './recruitee.source';
import { BambooHrSource } from './bamboohr.source';
import { TeamtailorSource } from './teamtailor.source';
import { BreezySource } from './breezy.source';
import { SmartRecruitersSource } from './smartrecruiters.source';
import { JazzHrSource } from './jazzhr.source';
import { RemoteOkSource } from './remoteok.source';
import { RemotiveSource } from './remotive.source';
import { SourcesService } from './sources.service';
import { WwrSource } from './wwr.source';

@Module({
  imports: [ConfigModule],
  providers: [
    GreenhouseSource,
    LeverSource,
    AshbySource,
    WorkableSource,
    RecruiteeSource,
    BambooHrSource,
    TeamtailorSource,
    BreezySource,
    SmartRecruitersSource,
    JazzHrSource,
    RemotiveSource,
    RemoteOkSource,
    WwrSource,
    SourcesService,
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
