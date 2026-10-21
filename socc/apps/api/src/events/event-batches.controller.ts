import { Controller, Get, Param } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { uuidParamSchema } from "../common/schemas.js";
import {
  CurrentOrganization,
  RequirePermissions,
  UseOrganizationContext,
  type OrganizationContext,
} from "../authorization/auth.decorators.js";
import { Permissions } from "../authorization/permissions.js";
import { EventsService } from "./events.service.js";

@ApiTags("event-batches")
@Controller("event-batches")
@UseOrganizationContext()
export class EventBatchesController {
  constructor(private readonly events: EventsService) {}

  @Get(":batchId")
  @RequirePermissions(Permissions.EVENTS_READ)
  @ApiOperation({ summary: "Get ingestion batch status" })
  async get(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("batchId", new ZodValidationPipe(uuidParamSchema)) batchId: string,
  ) {
    return this.events.getBatch(ctx, batchId);
  }
}
