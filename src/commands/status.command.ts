import { Command, CommandRunner, Option } from 'nest-commander';
import { AppError } from '../common/errors';
import { JobsRepository } from '../db/jobs.repository';
import { isValidStatus, STATUS_VALUES } from '../jobs/status';

interface StatusCommandOptions {
  note?: string;
}

@Command({ name: 'status', arguments: '<id> <state>', description: 'Update a job\'s status' })
export class StatusCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(params: string[], options: StatusCommandOptions = {}): Promise<void> {
    const [idStr, state] = params;
    const id = Number(idStr);
    if (!Number.isInteger(id)) {
      throw new AppError('CONFIG_INVALID', `"${idStr}" is not a valid job id`);
    }
    if (!isValidStatus(state)) {
      throw new AppError('CONFIG_INVALID', `"${state}" is not a valid status. Use one of: ${STATUS_VALUES.join(', ')}`);
    }

    await this.jobsRepository.updateStatus(id, state, options.note);
    if (state === 'applied') {
      await this.jobsRepository.markLatestApplicationApplied(id);
    }

    console.log(`#${id} → ${state}${options.note ? ` (${options.note})` : ''}`);
  }

  @Option({ flags: '--note <text>', description: 'Attach a note to this status change' })
  parseNote(value: string): string {
    return value;
  }
}
