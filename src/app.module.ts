import { Module } from '@nestjs/common';
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
import { SyncCommand } from './commands/sync.command';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { JobsModule } from './jobs/jobs.module';
import { SourcesModule } from './sources/sources.module';

@Module({
  imports: [ConfigModule, DbModule, SourcesModule, JobsModule],
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
  ],
})
export class AppModule {}
