# Security Operations Command Center (SOCC)

Phase 1 (Foundation and Tenant Security) of the SOCC platform. See `docs/`
for the full specification set this implementation is built from.

## Stack

- **API**: NestJS 12, strict TypeScript 5.9, ES modules (NodeNext)
- **Data**: PostgreSQL 17 (Docker, compose project `socc`, host port **5433**),
  Prisma 6 migrations
- **Security**: argon2 password hashing, opaque DB-backed sessions
  (SHA-256-hashed tokens in an HttpOnly SameSite=Lax cookie), deny-by-default
  RBAC, PostgreSQL row-level security (RLS) as defense in depth
- **Tests**: Vitest (unit + integration via Supertest); integration tests run
  against a real PostgreSQL instance

## Prerequisites

- Node >= 22.12, pnpm 11
- Docker (the SOCC-owned database only — never another project's containers)

## Quickstart

```sh
pnpm install                 # workspace install
cp .env.example apps/api/.env  # then adjust values if needed
pnpm db:up                   # start SOCC-owned PostgreSQL on port 5433
pnpm db:migrate              # apply Prisma migrations (owner role)
pnpm db:seed                 # optional synthetic dev data
pnpm dev                     # run the API in watch mode
```

The API serves health checks at `GET /health` and `GET /health/ready`;
everything else lives under the `/v1` prefix (e.g. `POST /v1/auth/register`).

## Commands

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `pnpm dev`               | Run the API in watch mode                         |
| `pnpm build`             | Build the API (`nest build`)                      |
| `pnpm lint`              | ESLint over the workspace                         |
| `pnpm typecheck`         | `tsc --noEmit`                                    |
| `pnpm format:check`      | Prettier check (spec docs in `docs/` are ignored) |
| `pnpm test:unit`         | Unit tests                                        |
| `pnpm test:integration`  | Integration tests (requires the database)         |
| `pnpm test`              | Unit + integration                                |
| `pnpm verify`            | format:check + lint + typecheck + test            |
| `pnpm db:up` / `db:down` | Start/stop the SOCC-owned PostgreSQL container    |
| `pnpm db:migrate`        | Apply migrations (owner role)                     |
| `pnpm db:seed`           | Seed synthetic dev data                           |

## Repository layout

```
socc/
  apps/api/          NestJS API (src/, prisma/, test/)
  docker/            PostgreSQL init script (socc_app role)
  docs/              Product/architecture specification (source documents)
  docker-compose.yml SOCC-owned PostgreSQL (project name: socc, port 5433)
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
