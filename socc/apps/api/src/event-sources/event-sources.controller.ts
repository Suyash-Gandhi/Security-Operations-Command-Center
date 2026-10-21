import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { EventSourceStatus } from "@prisma/client";
import type { SoccRequest } from "../common/http.types.js";
import { ZodValidationPipe } from "../common/zod-validation.pipe.js";
import {
  createEventSourceSchema,
  listEventSourcesQuerySchema,
  updateEventSourceStatusSchema,
  uuidParamSchema,
} from "../common/schemas.js";
import {
  CurrentOrganization,
  RequirePermissions,
  UseOrganizationContext,
  type OrganizationContext,
} from "../authorization/auth.decorators.js";
import { Permissions } from "../authorization/permissions.js";
import { EventSourcesService } from "./event-sources.service.js";

type CreateEventSourceBody = { name: string; sourceType: string };

type ListEventSourcesQuery = {
  limit: number;
  cursor?: string;
  status?: EventSourceStatus;
};

@ApiTags("event-sources")
@Controller("event-sources")
@UseOrganizationContext()
export class EventSourcesController {
  constructor(private readonly sources: EventSourcesService) {}

  @Get()
  @RequirePermissions(Permissions.EVENT_SOURCES_READ)
  @ApiOperation({ summary: "List event sources in the current organization" })
  async list(
    @CurrentOrganization() ctx: OrganizationContext,
    @Query(new ZodValidationPipe(listEventSourcesQuerySchema))
    query: ListEventSourcesQuery,
  ) {
    return this.sources.list(ctx, query);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions(Permissions.EVENT_SOURCES_WRITE)
  @ApiOperation({
    summary: "Create an event source and return its credential once",
  })
  async create(
    @CurrentOrganization() ctx: OrganizationContext,
    @Body(new ZodValidationPipe(createEventSourceSchema))
    body: CreateEventSourceBody,
    @Req() req: SoccRequest,
  ) {
    return this.sources.create(ctx, body, req.requestId);
  }

  @Post(":sourceId/rotate-credential")
  @HttpCode(200)
  @RequirePermissions(Permissions.EVENT_SOURCES_WRITE)
  @ApiOperation({ summary: "Rotate an event source credential" })
  async rotate(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("sourceId", new ZodValidationPipe(uuidParamSchema)) sourceId: string,
    @Req() req: SoccRequest,
  ) {
    return this.sources.rotateCredential(ctx, sourceId, req.requestId);
  }

  @Patch(":sourceId/status")
  @RequirePermissions(Permissions.EVENT_SOURCES_WRITE)
  @ApiOperation({ summary: "Enable or disable an event source" })
  async updateStatus(
    @CurrentOrganization() ctx: OrganizationContext,
    @Param("sourceId", new ZodValidationPipe(uuidParamSchema)) sourceId: string,
    @Body(new ZodValidationPipe(updateEventSourceStatusSchema))
    body: { status: EventSourceStatus },
    @Req() req: SoccRequest,
  ) {
    return this.sources.updateStatus(ctx, sourceId, body.status, req.requestId);
  }
}
