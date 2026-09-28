import { Command, CommandRunner, Option } from 'nest-commander';
import { SyncService } from '../jobs/sync.service';

interface SyncCommandOptions {
  source?: string;
  dryRun?: boolean;
}

@Command({ name: 'sync', description: 'Fetch jobs from configured sources and store new/changed listings' })
export class SyncCommand extends CommandRunner {
  constructor(private readonly syncService: SyncService) {
    super();
  }

  async run(_params: string[], options: SyncCommandOptions = {}): Promise<void> {
    const start = Date.now();
    const stats = await this.syncService.sync({ sourceFilter: options.source, dryRun: options.dryRun });
    const seconds = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`${options.dryRun ? 'Dry-run sync' : 'Sync'} complete in ${seconds}s`);

    const failedSummary = stats.failedTargets.map((f) => `${f.source}:${f.board} — ${f.error}`).join('; ');
    console.log(`Sources: ${stats.targetsOk} ok, ${stats.targetsFailed} failed${failedSummary ? ` (${failedSummary})` : ''}`);
    console.log(
      `Fetched ${stats.fetched} jobs → ${stats.inserted} new, ${stats.changed} changed, ${stats.duplicates} duplicates`,
    );

    if (stats.targetsFailed > 0) {
      process.exitCode = 2;
    }
  }

  @Option({ flags: '--source <name>', description: 'Only sync one source, e.g. greenhouse or greenhouse:stripe' })
  parseSource(value: string): string {
    return value;
  }

  @Option({ flags: '--dry-run', description: 'Fetch and diff without writing to the database' })
  parseDryRun(): boolean {
    return true;
  }
}
