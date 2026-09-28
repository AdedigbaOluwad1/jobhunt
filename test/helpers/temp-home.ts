import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.join(__dirname, '..', '..');

/**
 * Creates a throwaway $JOBHUNT_HOME with a freshly migrated sqlite db, for
 * tests that exercise real repository/Prisma behavior instead of mocks.
 * Mirrors exactly what `jobhunt init` does, so the schema under test is the
 * real one, not a hand-rolled approximation of it.
 */
export async function createTempHome(): Promise<{ home: string; cleanup: () => void }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'jobhunt-test-'));
  const previousHome = process.env.JOBHUNT_HOME;
  process.env.JOBHUNT_HOME = home;

  const prismaCli = require.resolve('prisma/build/index.js', { paths: [PACKAGE_ROOT] });
  const schema = path.join(PACKAGE_ROOT, 'prisma', 'schema.prisma');
  const config = path.join(PACKAGE_ROOT, 'prisma.config.ts');
  const dbFile = path.join(home, 'jobhunt.db');

  await execFileAsync(process.execPath, [prismaCli, 'migrate', 'deploy', '--schema', schema, '--config', config], {
    env: { ...process.env, DATABASE_URL: `file:${dbFile}` },
  });

  return {
    home,
    cleanup: () => {
      fs.rmSync(home, { recursive: true, force: true });
      if (previousHome === undefined) delete process.env.JOBHUNT_HOME;
      else process.env.JOBHUNT_HOME = previousHome;
    },
  };
}
