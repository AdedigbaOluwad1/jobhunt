import { Command, CommandRunner } from 'nest-commander';
import { JobsRepository } from '../db/jobs.repository';

@Command({ name: 'dismiss', arguments: '<ids...>', description: 'Mark one or more jobs as dismissed' })
export class DismissCommand extends CommandRunner {
  constructor(private readonly jobsRepository: JobsRepository) {
    super();
  }

  async run(params: string[]): Promise<void> {
    for (const idStr of params) {
      const id = Number(idStr);
      if (!Number.isInteger(id)) {
        console.error(`error: "${idStr}" is not a valid job id, skipping`);
        continue;
      }
      await this.jobsRepository.updateStatus(id, 'dismissed');
      console.log(`#${id} → dismissed`);
    }
  }
}
