import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { EventSourcesModule } from "../event-sources/event-sources.module.js";
import { IngestionController } from "./ingestion.controller.js";
import { IngestionService } from "./ingestion.service.js";

@Module({
  imports: [AuditModule, EventSourcesModule],
  controllers: [IngestionController],
  providers: [IngestionService],
})
export class IngestionModule {}
