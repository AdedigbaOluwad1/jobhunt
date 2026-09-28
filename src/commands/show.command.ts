import { Command, CommandRunner, Option } from 'nest-commander';
import { AppError } from '../common/errors';
import { JobsRepository } from '../db/jobs.repository';

interface ShowCommandOptions {
  desc?: boolean;
  json?: boolean;
}

@Command({ name: 'show', arguments: '<id>', description: 'Show full details for one job' })
export class ShowCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(params: string[], options: ShowCommandOptions = {}): Promise<void> {
    const id = Number(params[0]);
    if (!Number.isInteger(id)) {
      throw new AppError('CONFIG_INVALID', `"${params[0]}" is not a valid job id`);
    }

    const job = await this.jobsRepository.findById(id);
    if (!job) {
      throw new AppError('CONFIG_INVALID', `no job with id ${id}`);
    }

    if (options.json) {
      console.log(JSON.stringify(job, null, 2));
      return;
    }

    console.log(`#${job.id}  ${job.title} @ ${job.company}`);
    console.log(`location: ${job.location ?? '(none)'}${job.remote ? ' (remote)' : ''}`);
    console.log(`url:      ${job.url}`);
    if (job.applyUrl && job.applyUrl !== job.url) console.log(`apply:    ${job.applyUrl}`);
    console.log(`posted:   ${job.postedAt ? job.postedAt.toISOString().slice(0, 10) : '(unknown)'}`);
    console.log(`status:   ${job.status}${job.statusNote ? ` — ${job.statusNote}` : ''}`);
    console.log(`source:   ${job.source}:${job.board}`);
    if (job.duplicateOfId) console.log(`duplicate of: #${job.duplicateOfId}`);
    if (job.closedAt) console.log(`closed:   ${job.closedAt.toISOString().slice(0, 10)}`);

    if (options.desc) {
      console.log('\n--- description ---');
      console.log(job.descriptionText);
    }
  }

  @Option({ flags: '--desc', description: 'Include the full description text' })
  parseDesc(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Print raw JSON' })
  parseJson(): boolean {
    return true;
  }
}
