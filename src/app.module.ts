import { Module } from '@nestjs/common';
import { InitCommand } from './commands/init.command';

@Module({
  providers: [InitCommand],
})
export class AppModule {}
