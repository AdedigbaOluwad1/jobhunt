import * as fs from 'node:fs';
import { Command, CommandRunner, Option } from 'nest-commander';
import { AppError } from '../common/errors';
import { ExtractorService } from '../jobs/extractor.service';
import { ManualJobService } from '../jobs/manual-job.service';

interface AddCommandOptions {
  company?: string;
  title?: string;
  location?: string;
  remote?: boolean;
  descriptionFile?: string;
  /** Commander's negatable `--no-extract`: defaults to true, false when passed. */
  extract?: boolean;
}

function readDescription(file: string): string {
  try {
    return fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  } catch (err) {
    throw new AppError('INVALID_ARGUMENT', `couldn't read description from ${file === '-' ? 'stdin' : file}: ${(err as Error).message}`);
  }
}

@Command({
  name: 'add',
  arguments: '<url>',
  description: 'Track a single job from any URL (company site, LinkedIn, ...) and score it',
})
export class AddCommand extends CommandRunner {
  constructor(
    private readonly manualJobService: ManualJobService,
    private readonly extractorService: ExtractorService,
  ) {
    super();
  }

  async run(params: string[], options: AddCommandOptions = {}): Promise<void> {
    const description = options.descriptionFile ? readDescription(options.descriptionFile) : undefined;
    if (description !== undefined && !description.trim()) {
      throw new AppError('INVALID_ARGUMENT', 'the description is empty');
    }

    const { job, status, similarJob } = await this.manualJobService.add({
      url: params[0],
      company: options.company,
      title: options.title,
      location: options.location,
      remote: options.remote,
      description,
    });

    const verb = { inserted: 'added', changed: 'updated', unchanged: 'already tracked' }[status];
    console.log(`${verb} #${job.id}: ${job.title} — ${job.company}${job.location ? ` (${job.location})` : ''}`);
    if (similarJob) {
      console.log(`note: looks similar to #${similarJob.id} (${similarJob.source}), which is already tracked`);
    }

    if (options.extract === false) return;
    await this.printAnalysis(job.id);
  }

  private async printAnalysis(jobId: number): Promise<void> {
    try {
      const analysed = await this.extractorService.ensureExtraction(jobId);
      const score = analysed.extraction?.matchScore;
      if (score !== undefined) console.log(`match score: ${score}`);
    } catch (err) {
      // The job is saved either way; a missing API key shouldn't make `add` look like it failed.
      console.log(`not scored: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log(`next: jobhunt show ${jobId}  |  jobhunt tailor ${jobId}`);
  }

  @Option({ flags: '-c, --company <name>', description: 'Company name (needed if the page does not state it)' })
  parseCompany(value: string): string {
    return value;
  }

  @Option({ flags: '-t, --title <title>', description: 'Job title (needed if the page does not state it)' })
  parseTitle(value: string): string {
    return value;
  }

  @Option({ flags: '-l, --location <location>', description: 'Job location, e.g. "Lagos, Nigeria"' })
  parseLocation(value: string): string {
    return value;
  }

  @Option({ flags: '--remote', description: 'Mark the job as remote' })
  parseRemote(): boolean {
    return true;
  }

  @Option({
    flags: '-f, --description-file <path>',
    description: 'Read the job description from a file ("-" for stdin) instead of fetching the page; required for LinkedIn',
  })
  parseDescriptionFile(value: string): string {
    return value;
  }

  @Option({ flags: '--no-extract', description: 'Skip LLM scoring' })
  parseNoExtract(): boolean {
    return false;
  }
}
