import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import { listEventsQuerySchema, uuidParamSchema } from "../common/schemas.js";
import {
  CurrentOrganization,
  RequirePermissions,
  UseOrganizationContext,
  type OrganizationContext,
} from "../authorization/auth.decorators.js";
import { Permissions } from "../authorization/permissions.js";
import { EventsService, type ListEventsOptions } from "./events.service.js";

@ApiTags("events")
@Controller("events")
@UseOrganizationContext()
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @RequirePermissions(Permissions.EVENTS_READ)
  @ApiOperation({ summary: "List ingested events in the current organization" })
  async list(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ZodValidationPipe(listEventsQuerySchema)) query: ListEventsOptions,
  ) {
    return this.events.list(ctx, query);
  }

  @Get(":eventId")
  @RequirePermissions(Permissions.EVENTS_READ)
  @ApiOperation({ summary: "Get one ingested event" })
  async get(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("eventId", new ZodValidationPipe(uuidParamSchema)) eventId: string,
  ) {
    return this.events.get(ctx, eventId);
  }
}
