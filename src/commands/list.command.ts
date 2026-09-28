import { Command, CommandRunner, Option } from 'nest-commander';
import { formatAge } from '../common/text';
import { printTable } from '../common/table';
import { JobsRepository, JobWithExtraction } from '../db/jobs.repository';

interface ListCommandOptions {
  all?: boolean;
  company?: string;
  remote?: boolean;
  minScore?: number;
  limit?: number;
  format?: 'table' | 'json' | 'md';
}

@Command({ name: 'list', description: 'List stored jobs' })
export class ListCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(_params: string[], options: ListCommandOptions = {}): Promise<void> {
    const jobs = await this.jobsRepository.findForList({
      includeDuplicates: options.all,
      includeClosed: options.all,
      filterStatus: options.all ? undefined : 'passed',
      company: options.company,
      remote: options.remote,
      minScore: options.minScore,
      limit: options.limit ?? 20,
    });

    if (options.format === 'json') {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }

    if (options.format === 'md') {
      console.log(this.toMarkdown(jobs));
      return;
    }

    printTable(
      [
        { header: 'id', key: 'id' },
        { header: 'score', key: 'score' },
        { header: 'company', key: 'company' },
        { header: 'title', key: 'title' },
        { header: 'location', key: 'location' },
        { header: 'status', key: 'status' },
        { header: 'age', key: 'age' },
        ...(options.all ? [{ header: 'why', key: 'why' }] : []),
      ],
      jobs.map((job) => ({
        id: String(job.id),
        score: job.extraction ? String(job.extraction.matchScore) : '-',
        company: job.company,
        title: job.title,
        location: job.remote ? 'remote' : (job.location ?? ''),
        status: job.status,
        age: formatAge(job.firstSeenAt),
        why: job.filterReason ?? (job.duplicateOfId ? `duplicate of #${job.duplicateOfId}` : job.closedAt ? 'closed' : ''),
      })),
    );
  }

  private toMarkdown(jobs: JobWithExtraction[]): string {
    const lines = [`# jobhunt digest — ${new Date().toISOString().slice(0, 10)}`, '', '| score | company | title | location |', '|---|---|---|---|'];
    for (const job of jobs) {
      const score = job.extraction ? String(job.extraction.matchScore) : '-';
      const location = job.remote ? 'remote' : (job.location ?? '');
      lines.push(`| ${score} | ${job.company} | [${job.title}](${job.url}) | ${location} |`);
    }
    return lines.join('\n');
  }

  @Option({ flags: '--all', description: 'Include rejected, duplicate and closed jobs' })
  parseAll(): boolean {
    return true;
  }

  @Option({ flags: '--company <text>', description: 'Filter by company name substring' })
  parseCompany(value: string): string {
    return value;
  }

  @Option({ flags: '--remote', description: 'Only remote jobs' })
  parseRemote(): boolean {
    return true;
  }

  @Option({ flags: '--min-score <n>', description: 'Only jobs with an extraction match score at or above n' })
  parseMinScore(value: string): number {
    return Number(value);
  }

  @Option({ flags: '--limit <n>', description: 'Max rows to show (default 20)' })
  parseLimit(value: string): number {
    return Number(value);
  }

  @Option({ flags: '--format <format>', description: 'table, json, or md', choices: ['table', 'json', 'md'] })
  parseFormat(value: string): 'table' | 'json' | 'md' {
    return value as 'table' | 'json' | 'md';
  }
}
