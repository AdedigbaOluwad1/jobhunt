import { Injectable } from '@nestjs/common';
import { AshbySource } from './ashby.source';
import { GreenhouseSource } from './greenhouse.source';
import { LeverSource } from './lever.source';
import { JobSource, SourceName } from './source.interface';

@Injectable()
export class SourcesService {
  private readonly sources: JobSource[];

  constructor(greenhouse: GreenhouseSource, lever: LeverSource, ashby: AshbySource) {
    this.sources = [greenhouse, lever, ashby];
  }

  all(): JobSource[] {
    return this.sources;
  }

  bySourceName(name: SourceName): JobSource | undefined {
    return this.sources.find((source) => source.name === name);
  }
}
