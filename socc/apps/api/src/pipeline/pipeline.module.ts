import { Module } from "@nestjs/common";
import { EventConsumerService } from "./event-consumer.service.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import { RedisService } from "./redis.service.js";
import { DetectionModule } from "../detection/detection.module.js";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AppConfigModule } from "../config/app-config.module.js";

@Module({
  imports: [PrismaModule, AppConfigModule, DetectionModule],
  providers: [RedisService, OutboxPublisherService, EventConsumerService],
  exports: [RedisService, OutboxPublisherService, EventConsumerService],
})
export class PipelineModule {}
