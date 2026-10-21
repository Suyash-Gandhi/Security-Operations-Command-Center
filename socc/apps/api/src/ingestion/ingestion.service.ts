import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { EventBatch } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import { canonicalJson, sha256Hex } from "../common/crypto.util.js";
import type { AuthenticatedSource } from "../event-sources/event-sources.service.js";
import {
  computeDedupeKey,
  validateEvent,
  type IngestEnvelope,
  type ValidatedEvent,
} from "./ingestion.schemas.js";

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REPORTED_ERRORS = 50;

export interface BatchRejection {
  index: number;
  code: string;
  message: string;
}

export interface IngestResult {
  accepted: boolean;
  batchId: string;
  status: string;
  acceptedCount: number;
  rejectedCount: number;
  processedCount: number;
  idempotentReplay: boolean;
  errors: BatchRejection[];
}

export interface BatchView {
  batchId: string;
  status: string;
  acceptedCount: number;
  rejectedCount: number;
  processedCount: number;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

export function toBatchView(batch: EventBatch): BatchView {
  return {
    batchId: batch.id,
    status: batch.status,
    acceptedCount: batch.acceptedCount,
    rejectedCount: batch.rejectedCount,
    processedCount: batch.processedCount,
    errorSummary: batch.errorSummary,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
  };
}

function toResult(
  batch: EventBatch,
  errors: BatchRejection[],
  idempotentReplay: boolean,
): IngestResult {
  return {
    accepted: batch.acceptedCount > 0,
    batchId: batch.id,
    status: batch.status,
    acceptedCount: batch.acceptedCount,
    rejectedCount: batch.rejectedCount,
    processedCount: batch.processedCount,
    idempotentReplay,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
  };
}

function summarize(
  rejected: number,
  duplicates: number,
  errors: BatchRejection[],
): string | null {
  if (rejected === 0) return null;
  const parts = [`${rejected} event(s) rejected`];
  if (duplicates > 0) parts.push(`${duplicates} duplicate(s) ignored`);
  const first = errors[0];
  if (first) parts.push(`first error: ${first.code} (event ${first.index})`);
  return parts.join("; ").slice(0, 1000);
}

function isIdempotencyConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ingest(
    source: AuthenticatedSource,
    envelope: IngestEnvelope,
    idempotencyKey: string | undefined,
    requestId?: string,
  ): Promise<IngestResult> {
    const now = new Date();
    const requestHash = sha256Hex(canonicalJson(envelope));
    const validated: Array<{ index: number; value: ValidatedEvent }> = [];
    const initialErrors: BatchRejection[] = [];

    envelope.events.forEach((raw, index) => {
      const result = validateEvent(raw, now);
      if (result.ok) {
        validated.push({ index, value: result.value });
      } else {
        initialErrors.push({ index, code: result.code, message: result.message });
      }
    });

    if (validated.length === 0) {
      throw new ApiError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCodes.VALIDATION_ERROR,
        "No events in the batch passed validation.",
        { errors: initialErrors.slice(0, MAX_REPORTED_ERRORS) },
      );
    }

    let outcome: { batch: EventBatch; errors: BatchRejection[]; replay: boolean };
    try {
      outcome = await this.prisma.runWithOrg(source.organizationId, async (tx) => {
        await tx.$queryRaw`
          SELECT pg_advisory_xact_lock(
            hashtext(${`${source.organizationId}:${source.sourceId}`})
          )::text AS lock
        `;

        if (idempotencyKey) {
          const existing = await tx.idempotencyRecord.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId: source.organizationId,
                idempotencyKey,
              },
            },
          });
          if (existing && existing.expiresAt > now) {
            if (existing.requestHash !== requestHash) {
              throw new ApiError(
                HttpStatus.CONFLICT,
                ErrorCodes.IDEMPOTENCY_CONFLICT,
                "Idempotency key was already used with a different request body.",
              );
            }
            const batch = await tx.eventBatch.findUnique({
              where: { id: existing.resourceReference },
            });
            if (!batch) {
              throw new ApiError(
                HttpStatus.CONFLICT,
                ErrorCodes.IDEMPOTENCY_CONFLICT,
                "Idempotency record references a missing batch.",
              );
            }
            return { batch, errors: [], replay: true };
          }
          if (existing) {
            await tx.idempotencyRecord.delete({ where: { id: existing.id } });
          }
        }

        const batch = await tx.eventBatch.create({
          data: {
            organizationId: source.organizationId,
            sourceId: source.sourceId,
            acceptedCount: 0,
            rejectedCount: initialErrors.length,
          },
        });

        const errors = [...initialErrors];
        let acceptedCount = 0;
        let duplicateCount = 0;
        let latestEventTime: Date | null = null;

        for (const { index, value } of validated) {
          if (!latestEventTime || value.eventTime > latestEventTime) {
            latestEventTime = value.eventTime;
          }

          if (value.assetId) {
            const asset = await tx.asset.findFirst({
              where: {
                id: value.assetId,
                organizationId: source.organizationId,
              },
            });
            if (!asset) {
              errors.push({
                index,
                code: "ASSET_NOT_FOUND",
                message: "assetId does not reference an asset in this organization",
              });
              continue;
            }
          }

          const dedupeKey = computeDedupeKey(value);
          const duplicate = await tx.securityEvent.findUnique({
            where: {
              organizationId_sourceId_dedupeKey: {
                organizationId: source.organizationId,
                sourceId: source.sourceId,
                dedupeKey,
              },
            },
            select: { id: true },
          });
          if (duplicate) {
            duplicateCount += 1;
            continue;
          }

          const event = await tx.securityEvent.create({
            data: {
              batchId: batch.id,
              organizationId: source.organizationId,
              sourceId: source.sourceId,
              assetId: value.assetId,
              sourceEventId: value.sourceEventId,
              dedupeKey,
              schemaVersion: envelope.schemaVersion,
              eventType: value.eventType,
              eventTime: value.eventTime,
              severity: value.severity,
              actor: value.actor,
              sourceIp: value.sourceIp,
              normalizedPayload: {
                schemaVersion: envelope.schemaVersion,
                eventType: value.eventType,
                eventTime: value.eventTime.toISOString(),
                sourceEventId: value.sourceEventId,
                severity: value.severity,
                actor: value.actor,
                sourceIp: value.sourceIp,
                assetId: value.assetId,
                attributes: value.attributes as Prisma.InputJsonValue,
              },
            },
          });

          await tx.outboxMessage.create({
            data: {
              organizationId: source.organizationId,
              aggregateType: "SecurityEvent",
              aggregateId: event.id,
              messageType: "security.event.accepted",
              schemaVersion: envelope.schemaVersion,
              payload: {
                eventId: event.id,
                batchId: batch.id,
                organizationId: source.organizationId,
                sourceId: source.sourceId,
                schemaVersion: envelope.schemaVersion,
                eventType: event.eventType,
                eventTime: event.eventTime.toISOString(),
              },
            },
          });

          acceptedCount += 1;
        }

        const rejectedCount = errors.length + duplicateCount;
        const updated = await tx.eventBatch.update({
          where: { id: batch.id },
          data: {
            acceptedCount,
            rejectedCount,
            status: acceptedCount > 0 ? "ACCEPTED" : "REJECTED",
            errorSummary: summarize(rejectedCount, duplicateCount, errors),
            ...(acceptedCount === 0 ? { completedAt: new Date() } : {}),
          },
        });

        if (latestEventTime) {
          await tx.eventSource.update({
            where: { id: source.sourceId },
            data: { lastEventAt: latestEventTime },
          });
        }

        if (idempotencyKey) {
          await tx.idempotencyRecord.create({
            data: {
              organizationId: source.organizationId,
              idempotencyKey,
              requestHash,
              resourceReference: batch.id,
              expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
            },
          });
        }

        await this.audit.recordInTx(tx, {
          organizationId: source.organizationId,
          actorId: null,
          action: "events.batch_accepted",
          resourceType: "event_batch",
          resourceId: batch.id,
          metadata: {
            sourceId: source.sourceId,
            acceptedCount,
            rejectedCount,
            duplicateCount,
          },
          requestId: requestId ?? null,
        });

        return { batch: updated, errors, replay: false };
      });
    } catch (error) {
      if (idempotencyKey && isIdempotencyConflict(error)) {
        const existing = await this.prisma.runWithOrg(source.organizationId, (tx) =>
          tx.idempotencyRecord.findUnique({
            where: {
              organizationId_idempotencyKey: {
                organizationId: source.organizationId,
                idempotencyKey,
              },
            },
          }),
        );
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ApiError(
              HttpStatus.CONFLICT,
              ErrorCodes.IDEMPOTENCY_CONFLICT,
              "Idempotency key was already used with a different request body.",
            );
          }
          const batch = await this.prisma.runWithOrg(source.organizationId, (tx) =>
            tx.eventBatch.findUnique({ where: { id: existing.resourceReference } }),
          );
          if (batch) {
            return toResult(batch, [], true);
          }
        }
      }
      throw error;
    }

    return toResult(outcome.batch, outcome.errors, outcome.replay);
  }
}
