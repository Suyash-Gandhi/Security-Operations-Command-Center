import { HttpStatus, Injectable } from "@nestjs/common";
import type { SecurityEvent } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import type { OrganizationContext } from "../authorization/auth.decorators.js";
import { toBatchView, type BatchView } from "../ingestion/ingestion.service.js";

export interface EventView {
  id: string;
  batchId: string;
  sourceId: string;
  assetId: string | null;
  sourceEventId: string | null;
  schemaVersion: number;
  eventType: string;
  eventTime: string;
  receivedAt: string;
  severity: string | null;
  actor: string | null;
  sourceIp: string | null;
  normalizedPayload: unknown;
  processedAt: string | null;
}

export interface ListEventsOptions {
  limit: number;
  cursor?: string;
  eventType?: string;
  sourceId?: string;
  assetId?: string;
  severity?: string;
  from?: Date;
  to?: Date;
}

function toView(event: SecurityEvent): EventView {
  return {
    id: event.id,
    batchId: event.batchId,
    sourceId: event.sourceId,
    assetId: event.assetId,
    sourceEventId: event.sourceEventId,
    schemaVersion: event.schemaVersion,
    eventType: event.eventType,
    eventTime: event.eventTime.toISOString(),
    receivedAt: event.receivedAt.toISOString(),
    severity: event.severity,
    actor: event.actor,
    sourceIp: event.sourceIp,
    normalizedPayload: event.normalizedPayload,
    processedAt: event.processedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    ctx: OrganizationContext,
    options: ListEventsOptions,
  ): Promise<{ events: EventView[]; nextCursor: string | null }> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const timeFilter =
        options.from || options.to
          ? {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            }
          : undefined;
      const rows = await tx.securityEvent.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(options.eventType ? { eventType: options.eventType } : {}),
          ...(options.sourceId ? { sourceId: options.sourceId } : {}),
          ...(options.assetId ? { assetId: options.assetId } : {}),
          ...(options.severity ? { severity: options.severity } : {}),
          ...(timeFilter ? { eventTime: timeFilter } : {}),
        },
        orderBy: [{ eventTime: "desc" }, { id: "desc" }],
        take: options.limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, options.limit);
      return {
        events: page.map(toView),
        nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  async get(ctx: OrganizationContext, eventId: string): Promise<EventView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const event = await tx.securityEvent.findFirst({
        where: { id: eventId, organizationId: ctx.organizationId },
      });
      if (!event) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.EVENT_NOT_FOUND,
          "Event not found.",
        );
      }
      return toView(event);
    });
  }

  async getBatch(ctx: OrganizationContext, batchId: string): Promise<BatchView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const batch = await tx.eventBatch.findFirst({
        where: { id: batchId, organizationId: ctx.organizationId },
      });
      if (!batch) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.EVENT_BATCH_NOT_FOUND,
          "Event batch not found.",
        );
      }
      return toBatchView(batch);
    });
  }
}
