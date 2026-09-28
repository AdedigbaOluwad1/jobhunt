import * as fs from 'node:fs';
import { Injectable } from '@nestjs/common';
import { parse as parseYaml } from 'yaml';
import { AppError } from '../common/errors';
import { configPath } from '../common/paths';
import { AppConfig, ConfigSchema, formatConfigError } from './config.schema';

@Injectable()
export class ConfigService {
  private cached?: AppConfig;

  load(): AppConfig {
    if (this.cached) return this.cached;

    const path = configPath();
    if (!fs.existsSync(path)) {
      throw new AppError('CONFIG_MISSING', `config.yaml not found at ${path}. Run \`jobhunt init\` first.`);
    }

    const raw = fs.readFileSync(path, 'utf8');
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new AppError('CONFIG_INVALID', `config.yaml failed to parse: ${(err as Error).message}`);
    }

    const result = ConfigSchema.safeParse(parsed);
    if (!result.success) {
      throw new AppError('CONFIG_INVALID', formatConfigError(result.error));
    }

    this.cached = result.data;
    return this.cached;
  }
}
