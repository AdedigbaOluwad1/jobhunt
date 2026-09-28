import { Module } from '@nestjs/common';
import { JobsRepository } from './jobs.repository';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService, JobsRepository],
  exports: [JobsRepository],
})
export class DbModule {}
