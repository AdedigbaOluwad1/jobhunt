#!/usr/bin/env node
import 'reflect-metadata';
import { CommandFactory } from 'nest-commander';
import { AppModule } from './app.module';

async function bootstrap() {
  const verbose = process.argv.includes('--verbose');
  await CommandFactory.run(AppModule, {
    logger: verbose ? ['error', 'warn', 'debug', 'log', 'verbose'] : ['error', 'warn'],
    // Commander's own parse errors (unknown command, missing arg, --help, --version)
    // already print their own "error: ..." message and exit; leave errorHandler
    // unset so we don't double-print. Errors thrown from inside a command's run()
    // land in serviceErrorHandler instead, and are ours to format.
    serviceErrorHandler: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`error: ${message}\n`);
      if (verbose && err instanceof Error && err.stack) {
        process.stderr.write(`${err.stack}\n`);
      }
      process.exitCode = 1;
    },
  });
}

bootstrap();
