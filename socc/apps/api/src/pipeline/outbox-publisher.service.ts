import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppConfigService } from "../config/app-config.service.js";
import { RedisService } from "./redis.service.js";

interface OutboxRow {
  id: string;
  organizationId: string;
  aggregateType: string;
  aggregateId: string;
  messageType: string;
  schemaVersion: number;
  payload: Prisma.JsonValue;
  createdAt: Date;
  publishedAt: Date | null;
  attemptCount: number;
  lastError: string | null;
  nextAttemptAt: Date;
}

const MAX_CLAIM = 50;
const MAX_BACKOFF_MS = 60_000;

/** Exponential retry backoff for outbox publication, capped at one minute. */
export function computePublishBackoffMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(attemptCount - 1, 10));
  return Math.min(MAX_BACKOFF_MS, 500 * 2 ** exponent);
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Drains the transactional outbox into Redis Streams. Publication is
 * at-least-once: a crash after XADD but before marking the row published causes
 * a duplicate stream entry, which the consumer tolerates via idempotent
 * processing.
 */
@Injectable()
export class OutboxPublisherService {
  private readonly logger = new Logger(OutboxPublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  async publishPending(): Promise<number> {
    const rows = await this.prisma.$queryRaw<OutboxRow[]>`
      SELECT * FROM socc_claim_outbox(${MAX_CLAIM}::int)
    `;
    if (rows.length === 0) return 0;

    for (const row of rows) {
      try {
        await this.redis.connection.xadd(
          this.config.redisStream,
          "MAXLEN",
          "~",
          100_000,
          "*",
          "messageId",
          row.id,
          "organizationId",
          row.organizationId,
          "aggregateType",
          row.aggregateType,
          "aggregateId",
          row.aggregateId,
          "messageType",
          row.messageType,
          "schemaVersion",
          String(row.schemaVersion),
          "createdAt",
          row.createdAt.toISOString(),
          "payload",
          JSON.stringify(row.payload),
        );
        await this.prisma.$queryRaw`
          SELECT socc_mark_outbox_published(${row.id}::uuid)
        `;
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        const nextAttempt = new Date(
          Date.now() + computePublishBackoffMs(row.attemptCount),
        );
        this.logger.warn(
          `Outbox publication failed for ${row.id} (attempt ${row.attemptCount}): ${message}`,
        );
        try {
          await this.prisma.$queryRaw`
            SELECT socc_mark_outbox_failed(
              ${row.id}::uuid,
              ${message.slice(0, 1000)}::text,
              ${nextAttempt}::timestamptz
            )
          `;
        } catch (markError) {
          this.logger.error(
            `Could not record outbox failure for ${row.id}: ${
              markError instanceof Error ? markError.message : "unknown error"
            }`,
          );
        }
      }
    }
    return rows.length;
  }

  async run(signal: AbortSignal): Promise<void> {
    this.logger.log("Outbox publisher started");
    while (!signal.aborted) {
      try {
        const claimed = await this.publishPending();
        if (claimed === 0) {
          await sleep(1000, signal);
        }
      } catch (error) {
        this.logger.error(
          `Outbox publisher loop error: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
        await sleep(2000, signal);
      }
    }
    this.logger.log("Outbox publisher stopped");
  }
}
