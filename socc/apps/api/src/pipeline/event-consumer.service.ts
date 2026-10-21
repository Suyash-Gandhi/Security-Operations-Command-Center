import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppConfigService } from "../config/app-config.service.js";
import { RedisService } from "./redis.service.js";

interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

interface AcceptedMessage {
  messageId: string;
  organizationId: string;
  eventId: string;
  batchId: string;
}

const READ_COUNT = 10;
const BLOCK_MS = 5000;
const CLAIM_IDLE_MS = 30_000;
const CLAIM_COUNT = 25;
const MAX_DELIVERY_ATTEMPTS = 5;
const RETRY_KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

class PoisonMessageError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): StreamEntry | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const id = value[0];
  const rawFields = value[1];
  if (typeof id !== "string" || !Array.isArray(rawFields)) return null;
  const fields: Record<string, string> = {};
  for (let index = 0; index + 1 < rawFields.length; index += 2) {
    const key = rawFields[index];
    const fieldValue = rawFields[index + 1];
    if (typeof key !== "string" || typeof fieldValue !== "string") return null;
    fields[key] = fieldValue;
  }
  return { id, fields };
}

function parseEntries(value: unknown): StreamEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: StreamEntry[] = [];
  for (const item of value) {
    const entry = parseEntry(item);
    if (entry) entries.push(entry);
  }
  return entries;
}

function parseXReadGroup(result: unknown): StreamEntry[] {
  if (result === null || result === undefined) return [];
  if (result instanceof Map) {
    const entries: StreamEntry[] = [];
    for (const items of result.values()) {
      entries.push(...parseEntries(items));
    }
    return entries;
  }
  if (!Array.isArray(result)) return [];
  const entries: StreamEntry[] = [];
  for (const streamResult of result) {
    if (!Array.isArray(streamResult) || streamResult.length < 2) continue;
    entries.push(...parseEntries(streamResult[1]));
  }
  return entries;
}

function parseXAutoClaim(result: unknown): StreamEntry[] {
  if (!Array.isArray(result) || result.length < 2) return [];
  return parseEntries(result[1]);
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
 * Idempotent stream consumer. Each stream entry maps to one durably accepted
 * SecurityEvent. Processing marks the event and advances its batch count in one
 * transaction; a redelivered entry sees processedAt set and performs no
 * additional work. Entries are acknowledged only after the transaction commits.
 */
@Injectable()
export class EventConsumerService {
  private readonly logger = new Logger(EventConsumerService.name);
  private readonly consumerName = `socc-worker-${process.pid}`;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    await this.redis.ensureConsumerGroup(
      this.config.redisStream,
      this.config.redisConsumerGroup,
    );
    this.logger.log(`Event consumer ${this.consumerName} started`);
    await Promise.all([this.consumeLoop(signal), this.reclaimLoop(signal)]);
    this.logger.log("Event consumer stopped");
  }

  private async consumeLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result: unknown = await this.redis.connection.xreadgroup(
          "GROUP",
          this.config.redisConsumerGroup,
          this.consumerName,
          "COUNT",
          READ_COUNT,
          "BLOCK",
          BLOCK_MS,
          "STREAMS",
          this.config.redisStream,
          ">",
        );
        for (const entry of parseXReadGroup(result)) {
          await this.handleEntry(entry);
        }
      } catch (error) {
        if (signal.aborted) return;
        this.logger.error(
          `Stream read failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
        await sleep(1000, signal);
      }
    }
  }

  private async reclaimLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      await sleep(CLAIM_IDLE_MS, signal);
      if (signal.aborted) return;
      try {
        const result = await this.redis.connection.xautoclaim(
          this.config.redisStream,
          this.config.redisConsumerGroup,
          this.consumerName,
          CLAIM_IDLE_MS,
          "0-0",
          "COUNT",
          CLAIM_COUNT,
        );
        for (const entry of parseXAutoClaim(result)) {
          await this.handleEntry(entry);
        }
      } catch (error) {
        if (signal.aborted) return;
        this.logger.error(
          `Pending reclaim failed: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }

  private parseMessage(fields: Record<string, string>): AcceptedMessage {
    const messageId = fields.messageId;
    const organizationId = fields.organizationId;
    const aggregateId = fields.aggregateId;
    const rawPayload = fields.payload;
    if (
      !messageId ||
      !organizationId ||
      !aggregateId ||
      !rawPayload ||
      fields.messageType !== "security.event.accepted"
    ) {
      throw new PoisonMessageError("INVALID_ENVELOPE");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      throw new PoisonMessageError("INVALID_PAYLOAD_JSON");
    }
    if (!isRecord(payload)) {
      throw new PoisonMessageError("INVALID_PAYLOAD");
    }
    const eventId = payload.eventId;
    const batchId = payload.batchId;
    const payloadOrganizationId = payload.organizationId;
    if (
      typeof eventId !== "string" ||
      typeof batchId !== "string" ||
      typeof payloadOrganizationId !== "string"
    ) {
      throw new PoisonMessageError("INVALID_PAYLOAD");
    }
    if (eventId !== aggregateId || payloadOrganizationId !== organizationId) {
      throw new PoisonMessageError("SCOPE_MISMATCH");
    }
    return { messageId, organizationId, eventId, batchId };
  }

  private async handleEntry(entry: StreamEntry): Promise<void> {
    let message: AcceptedMessage;
    try {
      message = this.parseMessage(entry.fields);
    } catch (error) {
      const code = error instanceof PoisonMessageError ? error.code : "INVALID_ENVELOPE";
      this.logger.warn(`Quarantining stream entry ${entry.id}: ${code}`);
      await this.deadLetter(entry, code);
      return;
    }

    try {
      await this.process(message);
      await this.redis.connection.xack(
        this.config.redisStream,
        this.config.redisConsumerGroup,
        entry.id,
      );
      await this.clearRetry(message.messageId);
    } catch (error) {
      const code = error instanceof Error ? error.message : "PROCESSING_FAILED";
      if (error instanceof PoisonMessageError) {
        this.logger.warn(`Quarantining message ${message.messageId}: ${error.code}`);
        await this.deadLetter(entry, error.code, message);
        return;
      }
      const attempts = await this.recordRetry(message.messageId);
      if (attempts >= MAX_DELIVERY_ATTEMPTS) {
        this.logger.error(
          `Quarantining message ${message.messageId} after ${attempts} attempts: ${code}`,
        );
        await this.deadLetter(entry, code, message);
        return;
      }
      this.logger.warn(
        `Processing failed for message ${message.messageId} (attempt ${attempts}): ${code}`,
      );
    }
  }

  private async process(message: AcceptedMessage): Promise<void> {
    await this.prisma.runWithOrg(message.organizationId, async (tx) => {
      const event = await tx.securityEvent.findFirst({
        where: { id: message.eventId, organizationId: message.organizationId },
        select: { id: true, batchId: true, processedAt: true },
      });
      if (!event) {
        throw new PoisonMessageError("EVENT_NOT_FOUND");
      }
      if (event.processedAt) return;

      const marked = await tx.securityEvent.updateMany({
        where: { id: event.id, processedAt: null },
        data: { processedAt: new Date() },
      });
      if (marked.count === 0) return;

      const batch = await tx.eventBatch.update({
        where: { id: event.batchId },
        data: { processedCount: { increment: 1 } },
      });
      if (batch.processedCount >= batch.acceptedCount && batch.status !== "COMPLETED") {
        await tx.eventBatch.update({
          where: { id: batch.id },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      }
    });
  }

  private keyForRetries(): string {
    return `socc:delivery:${this.config.redisStream}:${this.config.redisConsumerGroup}`;
  }

  private async recordRetry(messageId: string): Promise<number> {
    const key = this.keyForRetries();
    const attempts = await this.redis.connection.hincrby(key, messageId, 1);
    await this.redis.connection.expire(key, RETRY_KEY_TTL_SECONDS);
    return attempts;
  }

  private async clearRetry(messageId: string): Promise<void> {
    await this.redis.connection.hdel(this.keyForRetries(), messageId);
  }

  private async deadLetter(
    entry: StreamEntry,
    code: string,
    message?: AcceptedMessage,
  ): Promise<void> {
    const deadLetterStream = `${this.config.redisStream}.dead-letter`;
    try {
      await this.redis.connection.xadd(
        deadLetterStream,
        "MAXLEN",
        "~",
        10_000,
        "*",
        "originalId",
        entry.id,
        "failedAt",
        new Date().toISOString(),
        "errorCode",
        code,
        "messageId",
        message?.messageId ?? entry.fields.messageId ?? "unknown",
        "organizationId",
        message?.organizationId ?? entry.fields.organizationId ?? "unknown",
        "eventId",
        message?.eventId ?? "unknown",
      );
      await this.redis.connection.xack(
        this.config.redisStream,
        this.config.redisConsumerGroup,
        entry.id,
      );
      if (message) await this.clearRetry(message.messageId);
    } catch (error) {
      this.logger.error(
        `Could not quarantine stream entry ${entry.id}: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
  }
}
