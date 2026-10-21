import { HttpStatus, Injectable } from "@nestjs/common";
import type { EventSource, EventSourceStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import { createSourceCredential, sha256Hex } from "../common/crypto.util.js";
import type { OrganizationContext } from "../authorization/auth.decorators.js";

export interface EventSourceView {
  id: string;
  name: string;
  sourceType: string;
  status: EventSourceStatus;
  lastEventAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedSource {
  sourceId: string;
  organizationId: string;
  sourceType: string;
}

export interface ListEventSourcesOptions {
  limit: number;
  cursor?: string;
  status?: EventSourceStatus;
}

function toView(source: EventSource): EventSourceView {
  return {
    id: source.id,
    name: source.name,
    sourceType: source.sourceType,
    status: source.status,
    lastEventAt: source.lastEventAt?.toISOString() ?? null,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  };
}

@Injectable()
export class EventSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(
    ctx: OrganizationContext,
    options: ListEventSourcesOptions,
  ): Promise<{ sources: EventSourceView[]; nextCursor: string | null }> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const rows = await tx.eventSource.findMany({
        where: {
          organizationId: ctx.organizationId,
          ...(options.status ? { status: options.status } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: options.limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, options.limit);
      return {
        sources: page.map(toView),
        nextCursor: rows.length > options.limit ? (page.at(-1)?.id ?? null) : null,
      };
    });
  }

  /**
   * Creates a source and returns the plaintext credential exactly once.
   * Only the SHA-256 digest is stored; it can never be displayed again.
   */
  async create(
    ctx: OrganizationContext,
    input: { name: string; sourceType: string },
    requestId?: string,
  ): Promise<{ source: EventSourceView; credential: string }> {
    const credential = createSourceCredential();
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const source = await tx.eventSource.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          sourceType: input.sourceType,
          credentialHash: credential.hash,
        },
      });
      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "event_source.created",
        resourceType: "event_source",
        resourceId: source.id,
        metadata: { sourceType: source.sourceType, name: source.name },
        requestId: requestId ?? null,
      });
      return { source: toView(source), credential: credential.token };
    });
  }

  async rotateCredential(
    ctx: OrganizationContext,
    sourceId: string,
    requestId?: string,
  ): Promise<{ source: EventSourceView; credential: string }> {
    const credential = createSourceCredential();
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const existing = await tx.eventSource.findFirst({
        where: { id: sourceId, organizationId: ctx.organizationId },
      });
      if (!existing) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.EVENT_SOURCE_NOT_FOUND,
          "Event source not found.",
        );
      }
      const source = await tx.eventSource.update({
        where: { id: existing.id },
        data: { credentialHash: credential.hash },
      });
      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "event_source.credential_rotated",
        resourceType: "event_source",
        resourceId: source.id,
        requestId: requestId ?? null,
      });
      return { source: toView(source), credential: credential.token };
    });
  }

  async updateStatus(
    ctx: OrganizationContext,
    sourceId: string,
    status: EventSourceStatus,
    requestId?: string,
  ): Promise<EventSourceView> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const existing = await tx.eventSource.findFirst({
        where: { id: sourceId, organizationId: ctx.organizationId },
      });
      if (!existing) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.EVENT_SOURCE_NOT_FOUND,
          "Event source not found.",
        );
      }
      const source = await tx.eventSource.update({
        where: { id: existing.id },
        data: { status },
      });
      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "event_source.status_updated",
        resourceType: "event_source",
        resourceId: source.id,
        metadata: { status },
        requestId: requestId ?? null,
      });
      return toView(source);
    });
  }

  /**
   * Authenticates an ingestion request using a per-source bearer credential.
   * The organization is derived from the verified source row, never from a
   * client-supplied organization header or body field.
   */
  async authenticateSource(token: string): Promise<AuthenticatedSource> {
    const credentialHash = sha256Hex(token);
    const source = await this.prisma.runWithSourceCredential(credentialHash, (tx) =>
      tx.eventSource.findUnique({
        where: { credentialHash },
        include: { organization: true },
      }),
    );

    if (!source) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.SOURCE_AUTH_FAILED,
        "Source authentication failed.",
      );
    }
    if (source.status !== "ACTIVE") {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ErrorCodes.SOURCE_DISABLED,
        "Event source is disabled.",
      );
    }
    if (source.organization.status !== "ACTIVE") {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ErrorCodes.SOURCE_DISABLED,
        "Event source is disabled.",
      );
    }
    return {
      sourceId: source.id,
      organizationId: source.organizationId,
      sourceType: source.sourceType,
    };
  }
}
