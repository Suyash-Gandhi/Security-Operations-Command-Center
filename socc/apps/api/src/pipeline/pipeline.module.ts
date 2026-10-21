import { Module } from "@nestjs/common";
import { EventConsumerService } from "./event-consumer.service.js";
import { OutboxPublisherService } from "./outbox-publisher.service.js";
import { RedisService } from "./redis.service.js";

@Module({
  providers: [RedisService, OutboxPublisherService, EventConsumerService],
  exports: [RedisService, OutboxPublisherService, EventConsumerService],
})
export class PipelineModule {}
