import { Command, CommandRunner, Option } from 'nest-commander';
import { AppError } from '../common/errors';
import { JobsRepository } from '../db/jobs.repository';
import type { Extraction } from '../generated/prisma/client';

interface ShowCommandOptions {
  desc?: boolean;
  json?: boolean;
}

function parseJsonArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed : [];
}

function printExtraction(extraction: Extraction): void {
  console.log('\n--- analysis ---');
  console.log(`score:    ${extraction.matchScore}`);
  console.log(`summary:  ${extraction.roleSummary}`);
  console.log(`seniority: ${extraction.seniority}${extraction.yearsExperienceMin !== null ? ` (${extraction.yearsExperienceMin}+ yrs)` : ''}`);
  console.log(`remote:   ${extraction.remotePolicy}${extraction.locationRestriction ? ` — ${extraction.locationRestriction}` : ''}`);

  const printList = (label: string, json: string) => {
    const items = parseJsonArray(json);
    if (items.length === 0) return;
    console.log(`${label}:`);
    for (const item of items) console.log(`  - ${item}`);
  };

  printList('requirements', extraction.requirements);
  printList('nice to have', extraction.niceToHave);
  printList('stack', extraction.stack);
  printList('match reasons', extraction.matchReasons);
  printList('gaps', extraction.gaps);
  printList('red flags', extraction.redFlags);
}

@Command({ name: 'show', arguments: '<id>', description: 'Show full details for one job' })
export class ShowCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(params: string[], options: ShowCommandOptions = {}): Promise<void> {
    const id = Number(params[0]);
    if (!Number.isInteger(id)) {
      throw new AppError('INVALID_ARGUMENT', `"${params[0]}" is not a valid job id`);
    }

    const job = await this.jobsRepository.findById(id);
    if (!job) {
      throw new AppError('INVALID_ARGUMENT', `no job with id ${id}`);
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

    if (job.extraction) {
      printExtraction(job.extraction);
    }

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
