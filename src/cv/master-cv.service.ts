import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { parse as parseYaml } from 'yaml';
import { AppError } from '../common/errors';
import { masterCvPath } from '../common/paths';
import { formatMasterCvError, MasterCv, MasterCvSchema } from './cv.schema';

@Injectable()
export class MasterCvService {
  private cached?: MasterCv;

  load(): MasterCv {
    if (this.cached) return this.cached;

    const path = masterCvPath();
    if (!fs.existsSync(path)) {
      throw new AppError('CONFIG_MISSING', `master-cv.yaml not found at ${path}. Run \`jobhunt init\` first.`);
    }

    const raw = fs.readFileSync(path, 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new AppError('CONFIG_INVALID', `master-cv.yaml failed to parse: ${(err as Error).message}`);
    }

    const result = MasterCvSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError('CONFIG_INVALID', formatMasterCvError(result.error));
    }

    this.cached = result.data;
    return this.cached;
  }
}
