import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { EventSourcesController } from "./event-sources.controller.js";
import { EventSourcesService } from "./event-sources.service.js";

@Module({
  imports: [AuditModule],
  controllers: [EventSourcesController],
  providers: [EventSourcesService],
  exports: [EventSourcesService],
})
export class EventSourcesModule {}
