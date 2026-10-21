# Phase 2 Implementation Notes - Assets and Event Ingestion

This document records the Phase 2 implementation decisions, verification, and
known limitations. It supplements `04-event-ingestion-and-processing.md` and
`06-api-contracts.md`; it does not add claims beyond what the tests demonstrate.

## 1. Delivered endpoints

All routes use the `/v1` prefix.

| Method | Route | Permission |
| --- | --- | --- |
| `GET` | `/assets` | `assets:read` |
| `POST` | `/assets` | `assets:write` |
| `GET` | `/assets/:assetId` | `assets:read` |
| `PATCH` | `/assets/:assetId` | `assets:write` |
| `GET` | `/event-sources` | `event_sources:read` |
| `POST` | `/event-sources` | `event_sources:write` |
| `POST` | `/event-sources/:sourceId/rotate-credential` | `event_sources:write` |
| `PATCH` | `/event-sources/:sourceId/status` | `event_sources:write` |
| `POST` | `/events/ingest` | source credential (no session) |
| `GET` | `/events` | `events:read` |
| `GET` | `/events/:eventId` | `events:read` |
| `GET` | `/event-batches/:batchId` | `events:read` |

Cross-tenant resource identifiers are concealed as `404` with stable error
codes. Ingestion derives the organization from the authenticated source and
ignores any organization value in the body (unknown fields are rejected).

## 2. Source authentication

- `POST /event-sources` returns a `socc_src_...` bearer credential exactly once.
- Only the SHA-256 digest is stored (`EventSource.credentialHash`).
- Rotation replaces the digest; the previous credential stops working
  immediately. A source can be disabled without deleting its history.
- Authentication runs in `PrismaService.runWithSourceCredential()`, which sets
  the transaction-local `app.current_source_credential_hash` GUC. The
  `EventSource` RLS select policy exposes only the row whose digest matches, so
  the runtime role cannot enumerate other sources before an organization
  context exists.
- Disabled sources and sources in suspended organizations return
  `403 SOURCE_DISABLED`. Unknown credentials return `401 SOURCE_AUTH_FAILED`.

## 3. Ingestion contract

`POST /events/ingest` accepts:

```json
{
  "schemaVersion": 1,
  "events": [
    {
      "sourceEventId": "optional-stable-source-id",
      "eventType": "auth.login",
      "eventTime": "2026-10-21T12:00:00Z",
      "severity": "LOW",
      "actor": "synthetic-user",
      "sourceIp": "192.0.2.10",
      "assetId": "optional-asset-uuid",
      "attributes": { "result": "success" }
    }
  ]
}
```

Limits and validation:

- 1 to 500 events per request; 1 MiB JSON body limit (`413 PAYLOAD_TOO_LARGE`).
- `attributes` are bounded to 64 KiB of canonical JSON per event.
- `eventTime` must be a valid timestamp, not before 2000-01-01, and not more
  than five minutes in the future. Received time is stored separately.
- `sourceIp`, when provided, must be a valid IPv4/IPv6 address.
- An `assetId` must reference an asset in the same organization; otherwise that
  event is rejected with `ASSET_NOT_FOUND`.
- Unknown fields are rejected rather than silently ignored.

Partial acceptance is supported. Invalid events are reported by index with a
code and a safe message (no raw payloads). If every event is invalid the request
returns `422 VALIDATION_ERROR` and no batch is created. If a batch contains only
duplicates, it is committed with status `REJECTED` so the client receives
deterministic counts.

Successful acceptance returns `202`:

```json
{
  "accepted": true,
  "batchId": "uuid",
  "status": "ACCEPTED",
  "acceptedCount": 1,
  "rejectedCount": 0,
  "processedCount": 0,
  "idempotentReplay": false,
  "errors": []
}
```

`202` means durable acceptance only. Detection and later processing may still be
pending; batch/event status exposes progress.

## 4. Idempotency and deduplication

Request idempotency:

- Optional `Idempotency-Key` header (1-200 visible ASCII characters).
- The request hash is the SHA-256 of canonical JSON (sorted object keys).
- The record lives for 24 hours and is written in the same transaction as the
  batch.
- Reuse with the same hash returns the original batch with
  `idempotentReplay: true`.
- Reuse with a different hash returns `409 IDEMPOTENCY_CONFLICT`.
- Expired records are replaced lazily on the next request.

Event deduplication:

- Preferred key: SHA-256 of the source-provided `sourceEventId`.
- Fallback key: SHA-256 of canonical normalized content (type, event time,
  actor, source IP, resolved asset, severity, and attributes).
- Uniqueness is `(organizationId, sourceId, dedupeKey)`.
- The fallback intentionally does not deduplicate on timestamp, actor, IP, or
  event type alone. Identical repeated events with every field identical can
  still collide; this limitation is inherent to fingerprint-based dedupe.
- Ingestion takes a per-source transaction advisory lock so concurrent
  submissions cannot race the check-then-insert dedupe path.

## 5. Durable acceptance and transactional outbox

One PostgreSQL transaction writes:

1. `SecurityEvent` rows for newly accepted events.
2. One `OutboxMessage` per accepted event (`security.event.accepted`).
3. The `EventBatch` counts/status.
4. The `IdempotencyRecord` when applicable.
5. `EventSource.lastEventAt`.
6. An audit entry (`events.batch_accepted`, counts only; no payload).

The API never publishes to Redis directly. A separate worker drains the outbox:

- `socc_claim_outbox(limit)` is a `SECURITY DEFINER` function that leases up to
  50 eligible rows with `FOR UPDATE SKIP LOCKED`, increments `attemptCount`, and
  moves `nextAttemptAt` forward by 30 seconds. This gives the runtime role a
  narrow cross-tenant outbox path without a session-wide RLS bypass.
- The publisher `XADD`s a bounded stream entry and then calls
  `socc_mark_outbox_published(id)`.
- Publication failure calls `socc_mark_outbox_failed(id, error, nextAttempt)`
  with exponential backoff (500 ms doubling, capped at 60 s). Error text is
  truncated to 1000 characters.
- A crash after `XADD` but before marking published causes duplicate delivery,
  which the consumer tolerates. Delivery is at-least-once, not exactly-once.

## 6. Redis Streams consumer

- Stream: `SOC_REDIS_STREAM` (default `socc.events.v1`).
- Consumer group: `SOC_REDIS_CONSUMER_GROUP` (default
  `socc-event-processors`); the group is created at `0` with `MKSTREAM` so
  existing entries are not skipped.
- Consumers read with `XREADGROUP`, process each entry, and `XACK` only after a
  successful database transaction.
- Processing sets `SecurityEvent.processedAt` and increments
  `EventBatch.processedCount` atomically. The batch becomes `COMPLETED` when the
  processed count reaches the accepted count. Redelivery sees `processedAt` and
  performs no extra work.
- The consumer validates envelope scope: the message's event ID must equal the
  aggregate ID, and payload/source organization IDs must match the envelope.
- Pending entries idle for 30 seconds are reclaimed with `XAUTOCLAIM`.
- Delivery attempts are tracked in a Redis hash with a seven-day TTL. After five
  attempts, or immediately for malformed/scope-mismatch messages, the entry is
  written to `<stream>.dead-letter` with failure metadata (no payload) and then
  acknowledged. If dead-lettering fails, the entry remains pending for retry.
- The publisher and consumer run in `pnpm worker` (or `pnpm start:worker` after a
  build), separate from the API process.

## 7. Data, permissions, and RLS

- New tables: `Asset`, `EventSource`, `EventBatch`, `SecurityEvent`,
  `OutboxMessage`, `IdempotencyRecord`.
- New permissions: `assets:read`, `assets:write`, `event_sources:read`,
  `event_sources:write`, `events:read`. Role mappings match Phase 1 intent:
  OWNER and SECURITY_ADMIN manage sources/assets; analysts, incident leads,
  auditors, and viewers are read-only; viewers do not see event sources.
- RLS is enabled on every new table. Organization-scoped access requires
  `app.current_organization_id`; `EventSource` additionally permits a single-row
  select by `app.current_source_credential_hash` for authentication.
- Runtime grants target `socc_app`; the API and worker use
  `SOC_APP_DATABASE_URL`. The Prisma CLI and seed use `DATABASE_URL`.
- Outbox worker functions are executable by `socc_app` but not `PUBLIC`.

## 8. Verification

Commands run locally against SOCC-owned containers:

- `pnpm db:migrate` (applies Phase 2 migration)
- `pnpm typecheck`
- `pnpm test:unit`
- `pnpm test:integration`
- `pnpm build`
- `pnpm verify`

Integration coverage includes:

- Asset CRUD, source credential one-time display, rotation, disablement
- Valid ingestion, durable outbox rows, idempotent replay, conflicting key
  reuse, duplicate source event IDs, all-invalid batches, cross-tenant asset
  references, invalid credentials, and tenant concealment
- End-to-end outbox publication into Redis, consumer processing, batch
  completion, and processed event timestamps

## 9. Known limitations and follow-ups

- CSV import (`POST /events/imports`) and object-storage upload are not
  implemented. Batch import currently means JSON batch ingestion.
- No HTTP metrics endpoint or dashboard exists yet. Queue lag, pending counts,
  oldest pending age, and dead-letter depth must be inspected with Redis tooling
  (`XLEN`, `XPENDING`, `XINFO GROUPS`) and worker logs.
- No per-source or per-organization rate limiting/quota is implemented.
  Overload returns the generic server behavior rather than a documented `429`.
  Add token-bucket limits before claiming sustained-throughput goals.
- No raw payload retention or `rawPayloadReference` storage is implemented.
  Normalized payloads are stored; sensitive raw data is intentionally not
  persisted.
- No operator UI/API exists for dead-letter inspection, controlled replay, or
  credential compromise response beyond manual rotation.
- Redis outage after commit is handled by leaving outbox rows unpublished and
  retrying, but ingestion does not check Redis health. This is deliberate: Redis
  is not part of the acceptance decision.
- The consumer's retry counter lives in Redis. A Redis data loss can reset
  retry counts; database processing idempotency still prevents duplicate
  effects.
- No benchmark evidence is provided for the roadmap throughput goals.
- `EventBatch` supports `ACCEPTED`, `COMPLETED`, and `REJECTED`. There is no
  separate `PROCESSING` state; `processedCount` versus `acceptedCount` conveys
  progress.
