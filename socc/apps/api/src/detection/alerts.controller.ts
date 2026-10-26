import { Controller, Get, Param, Query, Req } from "@nestjs/common";
import { RequirePermissions } from "../authorization/auth.decorators.js";
import { DetectionService } from "./detection.service.js";

@Controller("v1/alerts")
export class AlertsController {
  constructor(private readonly detection: DetectionService) {}

  @Get()
  @RequirePermissions("alerts:read")
  list(@Req() req: unknown, @Query() query: unknown) {
    const r = req as { organization: { id: string } };
    return this.detection.listAlerts(r.organization.id, query as Record<string, unknown>);
  }

  @Get(":alertId")
  @RequirePermissions("alerts:read")
  get(@Req() req: unknown, @Param("alertId") alertId: string) {
    const r = req as { organization: { id: string } };
    return this.detection.getAlert(r.organization.id, alertId);
  }
}
