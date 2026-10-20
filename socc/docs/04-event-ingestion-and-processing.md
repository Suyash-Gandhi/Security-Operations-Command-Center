# Event Ingestion and Processing

## 1. Pipeline goals

Accept events safely, durably record accepted data, process asynchronously, tolerate duplicate delivery, and expose processing status. Ingestion latency must not depend on LLM calls, email delivery, or long-running correlation.

## 2. Ingestion contract

Suggested endpoint: `POST /v1/events/ingest`.

The request may contain one event or a bounded batch. The source must be authenticated and scoped to an organization. Validate content type, schema version, payload size, batch size, timestamps, required fields, and source permissions.

A conceptual accepted response:

```json
{
  "accepted": true,
  "batchId": "opaque-batch-id",
  "acceptedCount": 100,
  "rejectedCount": 0,
  "status": "accepted"
}
```

This is illustrative, not a fixed implementation requirement. The actual response contract must be documented in OpenAPI.

Return an acceptance response only after durable acceptance. A `202 Accepted` response means processing may still be pending; it must not imply detection and incident processing have completed.

Define whether partial batch acceptance is supported. If it is, return per-record rejection information without exposing sensitive payloads. Bound error detail size.

## 3. Durable acceptance and transactional outbox

Recommended initial sequence:

1. Authenticate source and resolve trusted organization context.
2. Validate request and apply quota/rate limits.
3. Compute idempotency information.
4. In one PostgreSQL transaction, write accepted event records, batch status, idempotency record, and outbox messages.
5. Commit.
6. Return the batch reference.
7. An outbox publisher sends pending messages to Redis Streams.
8. Mark publication after send; tolerate duplicate publication.
9. Consumers process idempotently and acknowledge only after their durable side effects succeed.

If PostgreSQL is unavailable, do not claim durable acceptance. If Redis is unavailable after the database transaction commits, retain the outbox rows and retry publication.

## 4. Idempotency

Support a request idempotency key for retried submissions. Store a request hash and resulting resource/batch reference. Reuse of the same key with a different request body must return a documented conflict response.

For event-level deduplication, prefer a stable source event ID and uniqueness constraint scoped by organization and source. If the source lacks an ID, use a documented fingerprint strategy and acknowledge its limitations.

Do not deduplicate solely on timestamp, username, IP, or event type; legitimate repeated events can share these values.

## 5. Normalized event schema

The internal schema should contain fields similar to:

- `schemaVersion`
- `eventId`
- `organizationId` (trusted context, not blindly accepted from the payload)
- `sourceId`
- `sourceType`
- `sourceEventId`
- `eventType`
- `eventTime`
- `receivedAt`
- `severity` when available and mapped
- `actor` reference or normalized identity
- `sourceIp` where relevant
- `assetId` where resolved
- `attributes` with bounded source-specific data
- `rawPayloadReference` if raw retention is enabled

Normalization must be versioned. Preserve source-specific details where policy permits, and distinguish missing values from inferred values. Do not invent identity or asset mappings.

## 6. Processing stages

1. Decode and validate message schema.
2. Establish trusted organization/source scope.
3. Normalize event.
4. Enrich with known user/asset/source context.
5. Deduplicate.
6. Identify applicable detection rules.
7. Evaluate rules and time-window state.
8. Persist detection matches and alert changes transactionally where possible.
9. Correlate alerts with incidents.
10. Emit downstream notifications through an outbox or durable job.
11. Record metrics and processing outcome.
12. Acknowledge the queue message only after durable processing.

Where multiple steps cannot be made atomic, use idempotent stages and explicit processing states. Document the recovery behavior.

## 7. Queue and retry policy

- Use consumer groups for Redis Streams.
- Reclaim pending messages after consumer failure using a documented policy.
- Use bounded retries and backoff.
- Quarantine malformed or repeatedly failing messages in a dead-letter workflow.
- Preserve failure metadata without logging sensitive payloads.
- Provide controlled replay with tenant and authorization checks.
- Monitor pending message count, oldest pending age, retry count, and consumer lag.

A retry must not create duplicate alerts, incidents, audit entries, or notifications.

## 8. Backpressure and overload

Enforce per-source and per-organization quotas. Bound batch size, payload size, queue growth, worker concurrency, and database connection use. When the system cannot safely accept additional events, return a documented retryable response rather than falsely confirming success or silently dropping data.

Use `429` for applicable rate limits and `503` when temporary capacity or dependency failure prevents acceptance. Include retry guidance where safe.

## 9. CSV imports

Treat CSV import as a background job:
- Upload to controlled object storage.
- Validate file size and type.
- Parse with row limits and safe error reporting.
- Preview or validate before committing if the user workflow requires it.
- Record accepted/rejected counts.
- Prevent spreadsheet formula injection in exported CSV values.
- Do not execute formulas or macros.
- Restrict file access by organization and uploader permissions.

## 10. Event-time and late events

Store event time and received time separately. Define handling for clock skew, future timestamps, late events, and out-of-order arrivals. A late event may update historical views or trigger replay according to policy, but must not silently rewrite completed investigation history.

## 11. Required tests

- Duplicate request with same key and same payload.
- Same idempotency key with different payload.
- Duplicate source event IDs.
- Crash after DB commit before queue publication.
- Crash after queue publication before outbox marked published.
- Worker crash before acknowledgement.
- Redis outage.
- PostgreSQL outage.
- Malformed event and oversized batch.
- Tenant mismatch in source/event references.
- Late event and invalid timestamp.
- Poison message and controlled replay.
