import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module.js";
import { AssetsController } from "./assets.controller.js";
import { AssetsService } from "./assets.service.js";

@Module({
  imports: [AuditModule],
  controllers: [AssetsController],
  providers: [AssetsService],
})
export class AssetsModule {}
