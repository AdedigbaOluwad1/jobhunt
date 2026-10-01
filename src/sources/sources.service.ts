import { Injectable } from '@nestjs/common';
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
import { JobSource, SourceName } from './source.interface';
import { WwrSource } from './wwr.source';

@Injectable()
export class SourcesService {
  private readonly sources: JobSource[];

  constructor(
    greenhouse: GreenhouseSource,
    lever: LeverSource,
    ashby: AshbySource,
    workable: WorkableSource,
    recruitee: RecruiteeSource,
    bamboohr: BambooHrSource,
    teamtailor: TeamtailorSource,
    breezy: BreezySource,
    smartrecruiters: SmartRecruitersSource,
    jazzhr: JazzHrSource,
    remotive: RemotiveSource,
    remoteok: RemoteOkSource,
    wwr: WwrSource,
  ) {
    this.sources = [greenhouse, lever, ashby, workable, recruitee, bamboohr, teamtailor, breezy, smartrecruiters, jazzhr, remotive, remoteok, wwr];
  }

  all(): JobSource[] {
    return this.sources;
  }

  bySourceName(name: SourceName): JobSource | undefined {
    return this.sources.find((source) => source.name === name);
  }
}
