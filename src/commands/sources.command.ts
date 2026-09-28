import { Command, CommandRunner, SubCommand } from 'nest-commander';
import { AppError } from '../common/errors';
import { formatAge } from '../common/text';
import { printTable } from '../common/table';
import { addSourceTarget, ArraySource, isArraySource, removeSourceTarget } from '../config/config-editor';
import { JobsRepository } from '../db/jobs.repository';
import { SourceName } from '../sources/source.interface';
import { SourcesService } from '../sources/sources.service';

function parseTarget(raw: string): [string, string] {
  const idx = raw.indexOf(':');
  if (idx <= 0 || idx === raw.length - 1) {
    throw new AppError('CONFIG_INVALID', `expected "source:board", got "${raw}"`);
  }
  return [raw.slice(0, idx), raw.slice(idx + 1)];
}

function adapterSourceName(source: ArraySource): SourceName {
  return source === 'lever_eu' ? 'lever' : source;
}

@SubCommand({ name: 'list', description: 'Show configured source targets and their last sync state' })
export class SourcesListCommand extends CommandRunner {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly jobsRepository: JobsRepository,
  ) {
    super();
  }

  async run(): Promise<void> {
    const states = await this.jobsRepository.getSourceStates();
    const stateByKey = new Map(states.map((s) => [`${s.source}:${s.board}`, s]));

    const rows = [];
    for (const source of this.sourcesService.all()) {
      for (const target of source.targets()) {
        const state = stateByKey.get(`${target.source}:${target.board}`);
        rows.push({
          target: `${target.source}:${target.board}`,
          lastFetched: state?.lastFetchedAt ? `${formatAge(state.lastFetchedAt)} ago` : 'never',
          status: state ? (state.lastOk ? 'ok' : `error: ${state.lastError}`) : '-',
          jobs: state ? String(state.lastJobCount) : '-',
        });
      }
    }

    printTable(
      [
        { header: 'target', key: 'target' },
        { header: 'last fetched', key: 'lastFetched' },
        { header: 'status', key: 'status' },
        { header: 'jobs', key: 'jobs' },
      ],
      rows,
    );
  }
}

@SubCommand({ name: 'add', arguments: '<target>', description: 'Add a source target, e.g. greenhouse:stripe' })
export class SourcesAddCommand extends CommandRunner {
  constructor(private readonly sourcesService: SourcesService) {
    super();
  }

  async run(params: string[]): Promise<void> {
    const [source, board] = parseTarget(params[0]);
    if (!isArraySource(source)) {
      throw new AppError('CONFIG_INVALID', `unknown or unsupported source "${source}"`);
    }

    const adapter = this.sourcesService.bySourceName(adapterSourceName(source));
    if (!adapter) {
      throw new AppError('SOURCE_FETCH_FAILED', `no adapter registered yet for "${source}" (coming in a later phase)`);
    }

    await adapter.fetch({ source: adapterSourceName(source), board });

    const result = addSourceTarget(source, board);
    console.log(
      result.alreadyExists ? `${source}:${board} is already configured` : `added ${source}:${board} to config.yaml`,
    );
  }
}

@SubCommand({ name: 'remove', arguments: '<target>', description: 'Remove a source target from config.yaml' })
export class SourcesRemoveCommand extends CommandRunner {
  async run(params: string[]): Promise<void> {
    const [source, board] = parseTarget(params[0]);
    if (!isArraySource(source)) {
      throw new AppError('CONFIG_INVALID', `unknown or unsupported source "${source}"`);
    }

    const result = removeSourceTarget(source, board);
    console.log(
      result.removed
        ? `removed ${source}:${board} from config.yaml (stored jobs are kept, just no longer fetched)`
        : `${source}:${board} was not configured`,
    );
  }
}

@SubCommand({ name: 'check', description: 'Fetch every configured target once without storing anything' })
export class SourcesCheckCommand extends CommandRunner {
  constructor(private readonly sourcesService: SourcesService) {
    super();
  }

  async run(): Promise<void> {
    let anyFailed = false;
    for (const source of this.sourcesService.all()) {
      for (const target of source.targets()) {
        try {
          const jobs = await source.fetch(target);
          console.log(`ok    ${target.source}:${target.board} (${jobs.length} jobs)`);
        } catch (err) {
          anyFailed = true;
          console.log(`fail  ${target.source}:${target.board} — ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (anyFailed) process.exitCode = 2;
  }
}

@Command({
  name: 'sources',
  description: 'Manage configured job sources',
  subCommands: [SourcesListCommand, SourcesAddCommand, SourcesRemoveCommand, SourcesCheckCommand],
})
export class SourcesCommand extends CommandRunner {
  async run(): Promise<void> {
    console.log('Usage: jobhunt sources <list|add|remove|check>');
  }
}
