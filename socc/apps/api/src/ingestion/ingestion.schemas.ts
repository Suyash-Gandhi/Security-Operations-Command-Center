import { isIP } from "node:net";
import { z } from "zod";
import { canonicalJson, sha256Hex } from "../common/crypto.util.js";

export const MAX_EVENTS_PER_BATCH = 500;
export const MAX_ATTRIBUTE_BYTES = 64 * 1024;
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const MIN_EVENT_TIME_MS = Date.parse("2000-01-01T00:00:00.000Z");

const timestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be an ISO-8601 timestamp",
  });

export const ingestEnvelopeSchema = z
  .object({
    schemaVersion: z.number().int().min(1).max(10).default(1),
    events: z.array(z.unknown()).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict();

export const ingestEventSchema = z
  .object({
    sourceEventId: z.string().trim().min(1).max(256).optional(),
    eventType: z.string().trim().min(1).max(128),
    eventTime: timestampSchema,
    severity: z.string().trim().min(1).max(32).optional(),
    actor: z.string().trim().min(1).max(256).optional(),
    sourceIp: z
      .string()
      .trim()
      .max(64)
      .refine((value) => isIP(value) !== 0, { message: "must be an IP address" })
      .optional(),
    assetId: z.string().uuid().optional(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;
export type IngestEvent = z.infer<typeof ingestEventSchema>;

export interface ValidatedEvent {
  sourceEventId: string | null;
  eventType: string;
  eventTime: Date;
  severity: string | null;
  actor: string | null;
  sourceIp: string | null;
  assetId: string | null;
  attributes: Record<string, unknown>;
}

export type EventValidationResult =
  { ok: true; value: ValidatedEvent } | { ok: false; code: string; message: string };

function firstIssueMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "invalid event";
}

/**
 * Validates a single event and applies event-time bounds. Event time is kept
 * separate from received time; future skew and implausibly old times are
 * rejected so views cannot be poisoned by bad clocks.
 */
export function validateEvent(
  raw: unknown,
  now: Date = new Date(),
): EventValidationResult {
  const parsed = ingestEventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, code: "INVALID_EVENT", message: firstIssueMessage(parsed.error) };
  }
  const event = parsed.data;
  const eventTimeMs = Date.parse(event.eventTime);
  if (eventTimeMs < MIN_EVENT_TIME_MS) {
    return { ok: false, code: "EVENT_TIME_TOO_OLD", message: "eventTime is too old" };
  }
  if (eventTimeMs > now.getTime() + MAX_FUTURE_SKEW_MS) {
    return {
      ok: false,
      code: "EVENT_TIME_IN_FUTURE",
      message: "eventTime is too far in the future",
    };
  }
  const attributes = event.attributes ?? {};
  if (Buffer.byteLength(canonicalJson(attributes), "utf8") > MAX_ATTRIBUTE_BYTES) {
    return {
      ok: false,
      code: "ATTRIBUTES_TOO_LARGE",
      message: `attributes exceed ${MAX_ATTRIBUTE_BYTES} bytes`,
    };
  }
  return {
    ok: true,
    value: {
      sourceEventId: event.sourceEventId ?? null,
      eventType: event.eventType,
      eventTime: new Date(eventTimeMs),
      severity: event.severity ?? null,
      actor: event.actor ?? null,
      sourceIp: event.sourceIp ?? null,
      assetId: event.assetId ?? null,
      attributes,
    },
  };
}

/**
 * Stable bounded dedupe key. A source event id is preferred. Without one we
 * fingerprint the normalized source-specific content (not only timestamp,
 * actor, IP, or type), and document that identical repeated events can still
 * collide if every field is identical.
 */
export function computeDedupeKey(event: ValidatedEvent): string {
  if (event.sourceEventId) {
    return sha256Hex(`source-event-id:${event.sourceEventId}`);
  }
  const fingerprint = {
    eventType: event.eventType,
    eventTime: event.eventTime.toISOString(),
    actor: event.actor,
    sourceIp: event.sourceIp,
    assetId: event.assetId,
    severity: event.severity,
    attributes: event.attributes,
  };
  return sha256Hex(`fingerprint:${canonicalJson(fingerprint)}`);
}
