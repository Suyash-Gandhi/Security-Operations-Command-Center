import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { randomUUID } from "node:crypto";

export interface AuditEntry {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Append-only audit writer. Writes run inside an existing tenant transaction
 * when an organization context exists; organization-less entries (e.g. login
 * events) are written with only the user GUC set (or no GUC at all).
 *
 * Organization-less rows are inserted with raw SQL on purpose: PostgreSQL
 * applies SELECT row policies to INSERT ... RETURNING, and the AuditLog
 * select policy never exposes null-organization rows to the application
 * role, so a Prisma `create()` (which always uses RETURNING) would fail
 * with a row-level security violation. Raw INSERT without RETURNING keeps
 * those rows write-only for socc_app, as intended.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    const data = {
      id: randomUUID(),
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      requestId: entry.requestId ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
    };

    if (entry.organizationId) {
      await this.prisma.runWithOrg(entry.organizationId, (tx) =>
        tx.auditLog.create({ data }),
      );
      return;
    }

    if (entry.actorId) {
      await this.prisma.runWithUser(entry.actorId, (tx) =>
        insertWithoutReturning(tx, data),
      );
      return;
    }

    await insertWithoutReturning(this.prisma, data);
  }

  async recordInTx(tx: Prisma.TransactionClient, entry: AuditEntry): Promise<void> {
    const data = {
      id: randomUUID(),
      organizationId: entry.organizationId,
      actorId: entry.actorId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      requestId: entry.requestId ?? null,
      metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
    };
    if (entry.organizationId) {
      await tx.auditLog.create({ data });
      return;
    }
    await insertWithoutReturning(tx, data);
  }
}

async function insertWithoutReturning(
  client: Pick<PrismaService, "$executeRaw"> | Prisma.TransactionClient,
  data: {
    id: string;
    organizationId: string | null;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    requestId: string | null;
    metadata: Prisma.InputJsonValue;
  },
): Promise<void> {
  await client.$executeRaw`
    INSERT INTO "AuditLog"
      ("id", "organizationId", "actorId", "action", "resourceType",
       "resourceId", "requestId", "metadata", "occurredAt")
    VALUES (
      ${data.id}::uuid,
      ${data.organizationId}::uuid,
      ${data.actorId}::uuid,
      ${data.action},
      ${data.resourceType},
      ${data.resourceId}::uuid,
      ${data.requestId},
      ${JSON.stringify(data.metadata)}::jsonb,
      now()
    )`;
}
