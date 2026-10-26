import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
import { RequirePermissions } from "../authorization/auth.decorators.js";
import { DetectionService } from "./detection.service.js";

@Controller("v1/detection-rules")
export class DetectionController {
  constructor(private readonly detection: DetectionService) {}

  @Get()
  @RequirePermissions("detection_rules:read")
  list(@Req() req: unknown) {
    const r = req as { organization: { id: string } };
    return this.detection.listRules(r.organization.id);
  }

  @Post()
  @RequirePermissions("detection_rules:write")
  create(@Req() req: unknown, @Body() body: unknown) {
    const r = req as { organization: { id: string }; user?: { id: string } };
    return this.detection.createRule(r.organization.id, r.user?.id, body as Record<string, unknown>);
  }

  @Get(":ruleId")
  @RequirePermissions("detection_rules:read")
  get(@Req() req: unknown, @Param("ruleId") ruleId: string) {
    const r = req as { organization: { id: string } };
    return this.detection.getRule(r.organization.id, ruleId);
  }

  @Patch(":ruleId")
  @RequirePermissions("detection_rules:write")
  update(@Req() req: unknown, @Param("ruleId") ruleId: string, @Body() body: unknown) {
    const r = req as { organization: { id: string }; user?: { id: string } };
    return this.detection.updateRule(r.organization.id, r.user?.id, ruleId, body as Record<string, unknown>);
  }
}
