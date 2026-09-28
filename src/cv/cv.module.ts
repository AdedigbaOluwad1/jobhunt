import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { DbModule } from '../db/db.module';
import { JobsModule } from '../jobs/jobs.module';
import { LlmModule } from '../llm/llm.module';
import { MasterCvService } from './master-cv.service';
import { RenderService } from './render.service';
import { TailorService } from './tailor.service';

@Module({
  imports: [ConfigModule, DbModule, LlmModule, JobsModule],
  providers: [MasterCvService, RenderService, TailorService],
  exports: [MasterCvService, TailorService],
})
export class CvModule {}
