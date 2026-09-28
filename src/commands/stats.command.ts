import { Command, CommandRunner } from 'nest-commander';
import { printTable } from '../common/table';
import { JobsRepository } from '../db/jobs.repository';

@Command({ name: 'stats', description: 'Show counts and trends across stored jobs' })
export class StatsCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(): Promise<void> {
    const stats = await this.jobsRepository.getStats();

    console.log('By status:');
    printTable(
      [
        { header: 'status', key: 'status' },
        { header: 'count', key: 'count' },
      ],
      Object.entries(stats.byStatus).map(([status, count]) => ({ status, count: String(count) })),
    );

    console.log('\nJobs seen per week:');
    printTable(
      [
        { header: 'week', key: 'week' },
        { header: 'count', key: 'count' },
      ],
      stats.seenPerWeek.map((w) => ({ week: w.week, count: String(w.count) })),
    );

    console.log('\nApplications per week:');
    printTable(
      [
        { header: 'week', key: 'week' },
        { header: 'count', key: 'count' },
      ],
      stats.applicationsPerWeek.map((w) => ({ week: w.week, count: String(w.count) })),
    );

    console.log(
      `\nAverage match score of applied jobs: ${stats.avgAppliedMatchScore !== null ? stats.avgAppliedMatchScore.toFixed(1) : 'n/a (no applications with a score yet)'}`,
    );
    console.log(
      `Top source by matches: ${stats.topSourceByMatches ? `${stats.topSourceByMatches.source} (${stats.topSourceByMatches.count})` : 'n/a'}`,
    );
  }
}
