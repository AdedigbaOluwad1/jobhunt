import { Module } from '@nestjs/common';
import { ApplyCommand } from './commands/apply.command';
import { DismissCommand } from './commands/dismiss.command';
import { InitCommand } from './commands/init.command';
import { ListCommand } from './commands/list.command';
import { ShowCommand } from './commands/show.command';
import {
  SourcesAddCommand,
  SourcesCheckCommand,
  SourcesCommand,
  SourcesListCommand,
  SourcesRemoveCommand,
} from './commands/sources.command';
import { StatsCommand } from './commands/stats.command';
import { StatusCommand } from './commands/status.command';
import { SyncCommand } from './commands/sync.command';
import { TailorCommand } from './commands/tailor.command';
import { ConfigModule } from './config/config.module';
import { CvModule } from './cv/cv.module';
import { DbModule } from './db/db.module';
import { JobsModule } from './jobs/jobs.module';
import { SourcesModule } from './sources/sources.module';

@Module({
  imports: [ConfigModule, DbModule, SourcesModule, JobsModule, CvModule],
  providers: [
    InitCommand,
    SyncCommand,
    ListCommand,
    ShowCommand,
    SourcesCommand,
    SourcesListCommand,
    SourcesAddCommand,
    SourcesRemoveCommand,
    SourcesCheckCommand,
    TailorCommand,
    ApplyCommand,
    StatusCommand,
    DismissCommand,
    StatsCommand,
  ],
})
export class AppModule {}
