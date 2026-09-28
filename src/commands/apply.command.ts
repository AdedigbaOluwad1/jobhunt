import { Command, CommandRunner, Option } from 'nest-commander';
import { confirm, isInteractive } from '../common/confirm';
import { AppError } from '../common/errors';
import { openPath } from '../common/open-url';
import { TailorService } from '../cv/tailor.service';
import { JobsRepository } from '../db/jobs.repository';

interface ApplyCommandOptions {
  mark?: boolean;
}

@Command({ name: 'apply', arguments: '<id>', description: 'Open the apply page and print the tailored CV path' })
export class ApplyCommand extends CommandRunner {
  constructor(
    private readonly jobsRepository: JobsRepository,
    private readonly tailorService: TailorService,
  ) {
    super();
  }

  async run(params: string[], options: ApplyCommandOptions = {}): Promise<void> {
    const id = Number(params[0]);
    if (!Number.isInteger(id)) {
      throw new AppError('INVALID_ARGUMENT', `"${params[0]}" is not a valid job id`);
    }

    const job = await this.jobsRepository.findById(id);
    if (!job) {
      throw new AppError('INVALID_ARGUMENT', `no job with id ${id}`);
    }

    let application = await this.jobsRepository.findApplicationByJobId(id);
    if (!application) {
      if (isInteractive() && (await confirm('No tailored CV yet. Tailor now? [y/N]'))) {
        const result = await this.tailorService.tailorAndRender(id);
        console.log(`Tailored CV: ${result.cvPdfPath}`);
        application = await this.jobsRepository.findApplicationByJobId(id);
      } else {
        throw new AppError('INVALID_ARGUMENT', `no tailored CV for job ${id} yet. Run \`jobhunt tailor ${id}\` first.`);
      }
    }

    const target = job.applyUrl ?? job.url;
    openPath(target);
    console.log(`Opened: ${target}`);
    console.log(`CV:     ${application!.cvPdfPath}`);

    let shouldMark = options.mark ?? false;
    if (!shouldMark && isInteractive()) {
      shouldMark = await confirm('Mark as applied? [y/N]');
    }
    if (shouldMark) {
      await this.jobsRepository.updateStatus(id, 'applied');
      await this.jobsRepository.markLatestApplicationApplied(id);
      console.log(`#${id} → applied`);
    }
  }

  @Option({ flags: '--mark', description: 'Mark the job as applied without prompting' })
  parseMark(): boolean {
    return true;
  }
}
