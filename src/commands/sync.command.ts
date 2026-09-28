import { Command, CommandRunner, Option } from 'nest-commander';
import { printTable } from '../common/table';
import { ConfigService } from '../config/config.service';
import { SyncService, SyncStats } from '../jobs/sync.service';

interface SyncCommandOptions {
  source?: string;
  dryRun?: boolean;
  /**
   * Commander's `--no-` prefix is special: it declares a negatable boolean
   * named "extract" that defaults to true, not a separate "noExtract" flag.
   * `--no-extract` on the command line sets this to false.
   */
  extract?: boolean;
  maxExtract?: number;
}

function topReasons(counts: Record<string, number>, limit = 3): string {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([reason, count]) => `${reason} ×${count}`)
    .join(', ');
}

@Command({ name: 'sync', description: 'Fetch jobs from configured sources and store new/changed listings' })
export class SyncCommand extends CommandRunner {
  constructor(
    private readonly syncService: SyncService,
    private readonly configService: ConfigService,
  ) {
    super();
  }

  async run(_params: string[], options: SyncCommandOptions = {}): Promise<void> {
    const start = Date.now();
    const noExtract = options.extract === false;
    const stats = await this.syncService.sync({
      sourceFilter: options.source,
      dryRun: options.dryRun,
      noExtract,
      maxExtract: options.maxExtract,
    });
    const seconds = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`${options.dryRun ? 'Dry-run sync' : 'Sync'} complete in ${seconds}s`);

    // Adapter errors already read "source:board — message", so join them as-is.
    const failedSummary = stats.failedTargets.map((f) => f.error).join('; ');
    const skippedSummary = stats.skippedTargets.map((s) => `${s.source}:${s.board} — ${s.reason}`).join('; ');
    console.log(
      `Sources: ${stats.targetsOk} ok, ${stats.targetsFailed} failed${failedSummary ? ` (${failedSummary})` : ''}` +
        (stats.targetsSkipped > 0 ? `, ${stats.targetsSkipped} skipped (${skippedSummary})` : ''),
    );
    console.log(
      `Fetched ${stats.fetched} jobs → ${stats.inserted} new, ${stats.changed} changed, ${stats.closed} closed, ${stats.duplicates} duplicates`,
    );
    this.printFilterSummary(stats);
    this.printExtractionSummary(stats, options.dryRun ?? false, noExtract);
    this.printNewMatches(stats);

    if (stats.targetsFailed > 0) {
      process.exitCode = 2;
    }
  }

  private printFilterSummary(stats: SyncStats): void {
    const total = stats.filterPassed + stats.filterRejected;
    if (total === 0) return;
    const reasons = topReasons(stats.filterReasonCounts);
    console.log(`Filtered: ${stats.filterPassed} passed, ${stats.filterRejected} rejected${reasons ? ` (top reasons: ${reasons})` : ''}`);
  }

  private printExtractionSummary(stats: SyncStats, dryRun: boolean, noExtract: boolean): void {
    if (dryRun || noExtract) return;
    if (stats.extractionSkippedReason) {
      console.log(`Extraction skipped: ${stats.extractionSkippedReason}`);
      return;
    }
    if (stats.extracted + stats.extractionFailed === 0) return;
    console.log(`Extracted ${stats.extracted} (${stats.extractionFailed} failed)`);
  }

  private printNewMatches(stats: SyncStats): void {
    if (stats.newMatches.length === 0) return;
    const minScore = this.configService.load().sync.minScoreToHighlight;
    console.log(`\nNew matches ≥ ${minScore}:`);
    printTable(
      [
        { header: 'id', key: 'id' },
        { header: 'score', key: 'score' },
        { header: 'company', key: 'company' },
        { header: 'title', key: 'title' },
        { header: 'location', key: 'location' },
      ],
      stats.newMatches.map((m) => ({
        id: `#${m.id}`,
        score: String(m.score),
        company: m.company,
        title: m.title,
        location: m.location,
      })),
    );
  }

  @Option({ flags: '--source <name>', description: 'Only sync one source, e.g. greenhouse or greenhouse:stripe' })
  parseSource(value: string): string {
    return value;
  }

  @Option({ flags: '--dry-run', description: 'Fetch and diff without writing to the database' })
  parseDryRun(): boolean {
    return true;
  }

  // Commander never actually calls this for a negate (--no-*) flag — it sets
  // the boolean directly — but nest-commander still requires a decorated
  // method to register the option at all.
  @Option({ flags: '--no-extract', description: 'Skip LLM extraction/scoring this run' })
  parseExtract(): boolean {
    return false;
  }

  @Option({ flags: '--max-extract <n>', description: 'Cap how many jobs get (re-)extracted this run' })
  parseMaxExtract(value: string): number {
    return Number(value);
  }
}
