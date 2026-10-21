import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  createSourceCredential,
  sha256Hex,
} from "../../src/common/crypto.util.js";
import {
  computeDedupeKey,
  validateEvent,
} from "../../src/ingestion/ingestion.schemas.js";
import { computePublishBackoffMs } from "../../src/pipeline/outbox-publisher.service.js";

const now = new Date("2026-10-21T12:00:00.000Z");

describe("canonical JSON and source credentials", () => {
  it("serializes equivalent objects deterministically", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("issues high-entropy source credentials and stores only their digest", () => {
    const first = createSourceCredential();
    const second = createSourceCredential();
    expect(first.token).toMatch(/^socc_src_[A-Za-z0-9_-]{40,}$/);
    expect(first.hash).toBe(sha256Hex(first.token));
    expect(first.hash).not.toBe(second.hash);
    expect(first.hash).not.toContain(first.token);
  });
});

describe("event validation and dedupe keys", () => {
  it("accepts a valid event and normalizes optional fields", () => {
    const result = validateEvent(
      {
        eventType: "auth.login",
        eventTime: "2026-10-21T11:59:00.000Z",
        sourceIp: "192.0.2.10",
        attributes: { result: "failure", user: "synthetic" },
      },
      now,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.eventTime.toISOString()).toBe("2026-10-21T11:59:00.000Z");
    expect(result.value.severity).toBeNull();
    expect(result.value.attributes).toEqual({
      result: "failure",
      user: "synthetic",
    });
  });

  it("rejects invalid timestamps, future times, and malformed IPs", () => {
    const badTime = validateEvent({ eventType: "a", eventTime: "not-a-time" }, now);
    expect(badTime.ok).toBe(false);

    const future = validateEvent(
      { eventType: "a", eventTime: "2026-10-22T12:00:00.000Z" },
      now,
    );
    expect(future.ok).toBe(false);
    if (!future.ok) expect(future.code).toBe("EVENT_TIME_IN_FUTURE");

    const badIp = validateEvent(
      {
        eventType: "a",
        eventTime: "2026-10-21T11:00:00.000Z",
        sourceIp: "999.999.999.999",
      },
      now,
    );
    expect(badIp.ok).toBe(false);
  });

  it("rejects oversized attributes", () => {
    const result = validateEvent(
      {
        eventType: "a",
        eventTime: "2026-10-21T11:00:00.000Z",
        attributes: { blob: "x".repeat(70_000) },
      },
      now,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("ATTRIBUTES_TOO_LARGE");
  });

  it("prefers a stable source event id for dedupe", () => {
    const base = {
      sourceEventId: "evt-123",
      eventType: "auth.login",
      eventTime: new Date("2026-10-21T11:00:00.000Z"),
      severity: null,
      actor: "synthetic",
      sourceIp: null,
      assetId: null,
      attributes: { user: "synthetic" },
    };
    expect(computeDedupeKey(base)).toBe(computeDedupeKey(base));
    expect(computeDedupeKey(base)).not.toBe(
      computeDedupeKey({ ...base, sourceEventId: "evt-124" }),
    );
  });

  it("fingerprints all normalized content when no source event id exists", () => {
    const base = {
      sourceEventId: null,
      eventType: "auth.login",
      eventTime: new Date("2026-10-21T11:00:00.000Z"),
      severity: "HIGH",
      actor: "synthetic",
      sourceIp: "192.0.2.10",
      assetId: null,
      attributes: { result: "failure" },
    };
    const differentAttributes = {
      ...base,
      attributes: { result: "success" },
    };
    expect(computeDedupeKey(base)).not.toBe(computeDedupeKey(differentAttributes));
  });
});

describe("outbox publication backoff", () => {
  it("backs off exponentially with a one-minute cap", () => {
    expect(computePublishBackoffMs(1)).toBe(500);
    expect(computePublishBackoffMs(2)).toBe(1000);
    expect(computePublishBackoffMs(3)).toBe(2000);
    expect(computePublishBackoffMs(99)).toBe(60_000);
  });
});
