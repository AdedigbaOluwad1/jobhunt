import { Command, CommandRunner, Option } from 'nest-commander';
import { AppError } from '../common/errors';
import { openPath } from '../common/open-url';
import { TailorService } from '../cv/tailor.service';

interface TailorCommandOptions {
  regen?: boolean;
  open?: boolean;
}

@Command({ name: 'tailor', arguments: '<id>', description: 'Generate a tailored CV PDF for a job' })
export class TailorCommand extends CommandRunner {
  constructor(private readonly tailorService: TailorService) {
    super();
  }

  async run(params: string[], options: TailorCommandOptions = {}): Promise<void> {
    const id = Number(params[0]);
    if (!Number.isInteger(id)) {
      throw new AppError('CONFIG_INVALID', `"${params[0]}" is not a valid job id`);
    }

    const result = await this.tailorService.tailorAndRender(id, { regen: options.regen });

    if (result.reused) {
      console.log(`Already tailored: ${result.cvPdfPath}`);
      console.log('Use --regen to tailor again.');
    } else {
      console.log(`Tailored CV: ${result.cvPdfPath}${result.pages ? ` (${result.pages} page${result.pages === 1 ? '' : 's'})` : ''}`);
      for (const warning of result.warnings) {
        console.log(`  warning: ${warning}`);
      }
    }

    if (options.open) {
      openPath(result.cvPdfPath);
    }
  }

  @Option({ flags: '--regen', description: 'Re-tailor even if a PDF already exists for this job' })
  parseRegen(): boolean {
    return true;
  }

  @Option({ flags: '--open', description: 'Open the generated PDF' })
  parseOpen(): boolean {
    return true;
  }
}
