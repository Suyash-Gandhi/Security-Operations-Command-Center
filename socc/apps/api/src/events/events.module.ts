import { Module } from "@nestjs/common";
import { EventBatchesController } from "./event-batches.controller.js";
import { EventsController } from "./events.controller.js";
import { EventsService } from "./events.service.js";

@Module({
  controllers: [EventsController, EventBatchesController],
  providers: [EventsService],
})
export class EventsModule {}
