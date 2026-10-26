import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { DetectionEngineService } from "./detection-engine.service.js";
import { DetectionService } from "./detection.service.js";
import { DetectionController } from "./detection.controller.js";
import { AlertsController } from "./alerts.controller.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [DetectionController, AlertsController],
  providers: [DetectionEngineService, DetectionService],
  exports: [DetectionEngineService],
})
export class DetectionModule {}
