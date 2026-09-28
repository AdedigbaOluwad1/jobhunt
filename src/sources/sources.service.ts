import { Injectable } from '@nestjs/common';
import { GreenhouseSource } from './greenhouse.source';
import { JobSource, SourceName } from './source.interface';

@Injectable()
export class SourcesService {
  private readonly sources: JobSource[];

  constructor(greenhouse: GreenhouseSource) {
    this.sources = [greenhouse];
  }

  all(): JobSource[] {
    return this.sources;
  }

  bySourceName(name: SourceName): JobSource | undefined {
    return this.sources.find((source) => source.name === name);
  }
}
