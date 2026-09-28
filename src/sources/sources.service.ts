import { Injectable } from '@nestjs/common';
import { AshbySource } from './ashby.source';
import { GreenhouseSource } from './greenhouse.source';
import { LeverSource } from './lever.source';
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
    remotive: RemotiveSource,
    remoteok: RemoteOkSource,
    wwr: WwrSource,
  ) {
    this.sources = [greenhouse, lever, ashby, remotive, remoteok, wwr];
  }

  all(): JobSource[] {
    return this.sources;
  }

  bySourceName(name: SourceName): JobSource | undefined {
    return this.sources.find((source) => source.name === name);
  }
}
