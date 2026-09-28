import * as os from 'node:os';
import * as path from 'node:path';

export function jobhuntHome(): string {
  return process.env.JOBHUNT_HOME || path.join(os.homedir(), '.jobhunt');
}

export function configPath(): string {
  return path.join(jobhuntHome(), 'config.yaml');
}

export function masterCvPath(): string {
  return path.join(jobhuntHome(), 'master-cv.yaml');
}

export function envPath(): string {
  return path.join(jobhuntHome(), '.env');
}

export function dbPath(): string {
  return path.join(jobhuntHome(), 'jobhunt.db');
}

export function outDir(): string {
  return path.join(jobhuntHome(), 'out');
}

/**
 * Root of the installed jobhunt package (contains prisma/, templates/, dist/).
 * Resolved relative to this compiled file (dist/common/paths.js) rather than
 * cwd, so the CLI works the same from any directory after `npm link`.
 */
export function packageRoot(): string {
  return path.join(__dirname, '..', '..');
}

export function templatesDir(): string {
  return path.join(packageRoot(), 'templates');
}
