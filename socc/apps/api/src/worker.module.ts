import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { validateEnv } from "./config/env.validation.js";
import { AppConfigModule } from "./config/app-config.module.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { JsonLoggerService } from "./logger/json-logger.service.js";
import { PipelineModule } from "./pipeline/pipeline.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw: NodeJS.ProcessEnv) => validateEnv(raw),
    }),
    AppConfigModule,
    PrismaModule,
    PipelineModule,
  ],
  providers: [JsonLoggerService],
})
export class WorkerModule {}
