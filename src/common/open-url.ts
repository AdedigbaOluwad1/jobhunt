import { exec } from 'node:child_process';

/** Cross-platform "open this file/URL in the default app" — `open` on npm is ESM-only. */
export function openPath(path: string): void {
  const quoted = `"${path.replace(/"/g, '\\"')}"`;
  const command =
    process.platform === 'darwin'
      ? `open ${quoted}`
      : process.platform === 'win32'
        ? `cmd /c start "" ${quoted}`
        : `xdg-open ${quoted}`;
  exec(command);
}
