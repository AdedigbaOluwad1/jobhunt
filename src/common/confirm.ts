import * as readline from 'node:readline';

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

/** Only ever prompts when stdin is a TTY; otherwise resolves to `defaultValue` immediately. */
export async function confirm(question: string, defaultValue = false): Promise<boolean> {
  if (!isInteractive()) return defaultValue;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => rl.question(`${question} `, resolve));
  rl.close();

  const normalized = answer.trim().toLowerCase();
  if (normalized === '') return defaultValue;
  return normalized === 'y' || normalized === 'yes';
}
