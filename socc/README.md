# Security Operations Command Center (SOCC)

Phase 2 (Assets and Event Ingestion) of the SOCC platform. See `docs/` for the
full specification set this implementation is built from.

## Stack

- **API**: NestJS 12, strict TypeScript 5.9, ES modules (NodeNext)
- **Data**: PostgreSQL 16 (Docker, compose project `socc`, host port **5433**),
  Prisma 6 migrations
- **Pipeline**: Redis 7 Streams (SOCC-owned, host port **6380**) with consumer
  groups, transactional outbox publication, pending-message reclaim, and a
  dead-letter stream
- **Security**: argon2 password hashing, opaque DB-backed sessions
  (SHA-256-hashed tokens in an HttpOnly SameSite=Lax cookie), deny-by-default
  RBAC, per-source ingestion credentials stored only as SHA-256 digests,
  PostgreSQL row-level security (RLS) as defense in depth
- **Tests**: Vitest (unit + integration via Supertest); integration tests run
  against real PostgreSQL and Redis instances

## Prerequisites

- Node >= 22.12, pnpm 11
- Docker (the SOCC-owned database only — never another project's containers)

## Quickstart

```sh
pnpm install                 # workspace install
cp .env.example apps/api/.env  # then adjust values if needed
pnpm infra:up                # start SOCC-owned PostgreSQL (5433) and Redis (6380)
pnpm db:migrate              # apply Prisma migrations (owner role)
pnpm db:seed                 # optional synthetic dev data
pnpm dev                     # run the API in watch mode
pnpm worker                  # in a second terminal: outbox publisher + consumer
```

The API serves health checks at `GET /health` and `GET /health/ready`;
everything else lives under the `/v1` prefix (e.g. `POST /v1/auth/register`).

## Commands

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `pnpm dev`               | Run the API in watch mode                         |
| `pnpm worker`            | Run the outbox publisher and stream consumer      |
| `pnpm build`             | Build the API (`nest build`)                      |
| `pnpm lint`              | ESLint over the workspace                         |
| `pnpm typecheck`         | `tsc --noEmit`                                    |
| `pnpm format:check`      | Prettier check (spec docs in `docs/` are ignored) |
| `pnpm test:unit`         | Unit tests                                        |
| `pnpm test:integration`  | Integration tests (requires PostgreSQL and Redis) |
| `pnpm test`              | Unit + integration                                |
| `pnpm verify`            | format:check + lint + typecheck + test            |
| `pnpm infra:up`          | Start SOCC-owned PostgreSQL and Redis             |
| `pnpm db:up` / `db:down` | Start/stop SOCC-owned services (compose project)  |
| `pnpm redis:up`          | Start the SOCC-owned Redis container              |
| `pnpm db:migrate`        | Apply migrations (owner role)                     |
| `pnpm db:seed`           | Seed synthetic dev data                           |

## Repository layout

```
socc/
  apps/api/          NestJS API (src/, prisma/, test/)
  docker/            PostgreSQL init script (socc_app role)
  docs/              Product/architecture specification (source documents)
  docker-compose.yml SOCC-owned PostgreSQL and Redis (project name: socc)
```

## Phase 1 status

Implemented and verified:

- Multi-tenant organizations with OWNER-first membership bootstrap
- Registration, login, logout, `/v1/auth/me`, HttpOnly session cookies
- RBAC (OWNER, SECURITY_ADMIN, SECURITY_ANALYST, INCIDENT_LEAD, AUDITOR,
  VIEWER) enforced by a deny-by-default permissions guard
- Server-verified `X-Organization-Id` tenant context (client values are never
  trusted; cross-tenant probes return 404)
- LAST_OWNER invariant, owner-grant restrictions, revoked-membership locking
- PostgreSQL RLS with least-privilege runtime role (`socc_app`) and
  transaction-local GUC tenant context; append-only audit log
- CSRF origin checks, login throttling, global error envelope, request IDs

Known Phase 1 limitations and design decisions are documented in
`docs/15-phase1-implementation-notes.md`.

## Phase 2 status

Implemented and verified:

- Asset inventory CRUD with pagination, filtering, deactivation, and audit
- Event sources with one-time credential display, rotation, disable/enable,
  last-event tracking, and no plaintext secret storage
- Authenticated `POST /v1/events/ingest` with bounded batches (500 events,
  1 MiB request body), per-event validation, partial acceptance reporting,
  event-time bounds, IP validation, and bounded attribute size
- Durable acceptance in one PostgreSQL transaction: events, batch, idempotency
  record, outbox messages, source health, and audit
- Request idempotency (24-hour records) with same-key/different-body conflict
- Event-level dedupe by source event ID, otherwise a documented normalized
  fingerprint scoped by organization and source
- Outbox publisher with leased claims, exponential retry, and at-least-once
  Redis Streams publication
- Consumer group processing with idempotent event/batch updates, acknowledgement
  only after commit, pending-message reclaim, bounded retries, and a dead-letter
  stream
- Read APIs for events and batch status; tenant isolation and RLS for all new
  tables
- Worker health is observable through logs and batch/event status; no metrics
  endpoint is exposed yet

Example ingestion:

```sh
curl -X POST http://localhost:3000/v1/events/ingest \
  -H "Authorization: Bearer socc_src_..." \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: optional-retry-key" \
  -d '{"schemaVersion":1,"events":[{"eventType":"auth.login","eventTime":"2026-10-21T12:00:00Z","sourceEventId":"evt-1","attributes":{"result":"success"}}]}'
```

Phase 2 design decisions and known limitations are documented in
`docs/16-phase2-implementation-notes.md`.
