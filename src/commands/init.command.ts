import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command, CommandRunner } from 'nest-commander';
import pc from 'picocolors';
import {
  configPath,
  dbPath,
  envPath,
  jobhuntHome,
  masterCvPath,
  outDir,
  packageRoot,
  templatesDir,
} from '../common/paths';

const execFileAsync = promisify(execFile);

@Command({ name: 'init', description: 'Set up JOBHUNT_HOME: config, master CV, .env and the database' })
export class InitCommand extends CommandRunner {
  async run(): Promise<void> {
    const home = jobhuntHome();
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(outDir(), { recursive: true });

    const created: string[] = [];
    const skipped: string[] = [];

    this.copyIfMissing(path.join(templatesDir(), 'config.example.yaml'), configPath(), created, skipped);
    this.copyIfMissing(path.join(templatesDir(), 'master-cv.example.yaml'), masterCvPath(), created, skipped);
    this.writeIfMissing(envPath(), 'ANTHROPIC_API_KEY=\n', created, skipped);

    await this.migrate();

    console.log(pc.bold('jobhunt home:'), home);
    for (const f of created) console.log(pc.green('created'), f);
    for (const f of skipped) console.log(pc.dim('exists '), f);
    console.log(pc.green('database migrated'), dbPath());

    console.log('\nNext steps:');
    console.log(`  1. Set ANTHROPIC_API_KEY in ${envPath()}`);
    console.log(`  2. Edit ${configPath()} (watchlist, filters, profile)`);
    console.log(`  3. Edit ${masterCvPath()} with your real CV details`);
    console.log('  4. Run `jobhunt sync` to fetch jobs');
  }

  private copyIfMissing(src: string, dest: string, created: string[], skipped: string[]) {
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      return;
    }
    fs.copyFileSync(src, dest);
    created.push(dest);
  }

  private writeIfMissing(dest: string, contents: string, created: string[], skipped: string[]) {
    if (fs.existsSync(dest)) {
      skipped.push(dest);
      return;
    }
    fs.writeFileSync(dest, contents);
    created.push(dest);
  }

  private async migrate(): Promise<void> {
    const root = packageRoot();
    const prismaBin = path.join(root, 'node_modules', '.bin', 'prisma');
    const schema = path.join(root, 'prisma', 'schema.prisma');
    const config = path.join(root, 'prisma.config.ts');

    await execFileAsync(prismaBin, ['migrate', 'deploy', '--schema', schema, '--config', config], {
      env: { ...process.env, DATABASE_URL: `file:${dbPath()}` },
    });
  }
}
