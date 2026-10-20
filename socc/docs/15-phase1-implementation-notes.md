# Phase 1 Implementation Notes

Status of the Phase 1 (Foundation and Tenant Security) implementation, with
the design decisions and limitations that are not obvious from the code.

## Verified state (2026-10-20)

All commands run from `socc/` on Windows against the SOCC-owned PostgreSQL
container (`socc-postgres`, compose project `socc`, host port 5433):

| Command          | Result                                             |
| ---------------- | -------------------------------------------------- |
| `pnpm typecheck` | pass (`tsc --noEmit`)                              |
| `pnpm lint`      | pass (0 errors)                                    |
| `pnpm format:check` | pass                                             |
| `pnpm test:unit` | 16/16 passed                                       |
| `pnpm test:integration` | 41/41 passed (4 files)                      |
| `pnpm test`      | 57/57 passed                                       |
| `pnpm build`     | pass (`nest build`)                                |
| `pnpm verify`    | pass (format + lint + typecheck + all tests)       |
| `pnpm db:seed`   | pass (synthetic dev data)                          |

Two migrations are applied and in sync with `schema.prisma`:
`20261020172657_init` and `20261020172728_rls_and_authz_foundation`.

Database roles:

- `socc_owner` — table owner, superuser, bypasses RLS. Used **only** by the
  Prisma CLI (migrations/seed) and test fixtures. The API never connects with
  it.
- `socc_app` — least-privilege runtime role used by the API and by the
  app-role integration tests. RLS is enforced for this role; it has no
  UPDATE/DELETE grants on `AuditLog` (append-only).

## Request pipeline

Global guard order (all registered via `APP_GUARD`):

1. `SessionAuthGuard` — validates the opaque session cookie
   (HttpOnly, SameSite=Lax; only the SHA-256 hash is stored server-side).
   Fails closed with 401; `@Public()` routes are exempt.
2. `OriginGuard` — CSRF defense: when a browser sends `Origin`, it must be in
   `ALLOWED_ORIGINS`; `Sec-Fetch-Site` must be same-origin/none for
   state-changing methods. Requests without these headers (non-browser
   tooling) pass.
3. `OrganizationContextGuard` — reads `X-Organization-Id`, then verifies
   server-side that the caller has an ACTIVE membership in that organization.
   Missing header = 400; unknown/inaccessible organization = 404
   (resource concealment, so tenant IDs cannot be probed).
4. `PermissionsGuard` — deny-by-default: routes must declare
   `@RequirePermissions(...)`; only permission codes resolved from the
   verified membership are used (never client input, never raw role names).

Routes are served under the global `v1` prefix (`health` and `health/ready`
excluded).

## Tenant isolation and RLS

Two independent layers:

1. **Application layer** — every organization-scoped query runs inside
   `PrismaService.runWithTenant()` / `runWithUser()` / `runWithOrg()`, which
   set transaction-local GUCs (`app.current_user_id`,
   `app.current_organization_id`) via `set_config(..., true)`.
2. **Database layer** — RLS policies on `OrganizationMembership` and
   `AuditLog` consume those GUCs. With no GUC set, the application role sees
   **zero** rows of either table. Verified by direct SQL in
   `test/integration/rls.spec.ts`.

Integrity notes:

- Writes to `OrganizationMembership` are only permitted where
  `organizationId` matches the trusted org GUC (WITH CHECK), so a
  compromised application path still cannot create cross-tenant memberships.
- `AuditLog` is append-only for `socc_app` (REVOKE UPDATE, DELETE) and
  readable only under the matching organization GUC.
- **Null-organization audit rows (login events) are write-only for the app
  role.** PostgreSQL applies SELECT policies to `INSERT ... RETURNING`, and
  Prisma's `create()` always uses RETURNING; therefore `AuditService` inserts
  those rows with raw SQL and no RETURNING. This is deliberate, not a
  workaround to remove casually.

## Roles and permissions

Roles: OWNER, SECURITY_ADMIN, SECURITY_ANALYST, INCIDENT_LEAD, AUDITOR,
VIEWER — seeded by the RLS migration with deterministic UUIDs and mirrored in
`src/authorization/permissions.ts` (6 roles, 5 permissions, 20
role-permission bindings).

- Only OWNER holds `org:update` and may grant the OWNER role.
- The last ACTIVE OWNER cannot be demoted or revoked (409 `LAST_OWNER`).
- SECURITY_ADMIN may manage members but not grant OWNER.

## Known limitations (documented trade-offs)

- **Login throttling** is in-process and fixed-window (10 attempts / 15 min
  per IP+email). It does not span replicas; the documented upgrade path is a
  shared store (Redis) when Phase 2 introduces the event pipeline.
- **No CI configuration** exists at the repository root yet (the git repo
  root is the parent directory of `socc/`); `pnpm verify` is the intended
  entry point.
- **Frontend** is deferred (Phase 1 is API-only, per scope).
- ESLint's `consistent-type-imports` rule is intentionally disabled: NestJS
  uses `emitDecoratorMetadata`, which requires constructor-injected classes
  to be imported as runtime values (a type-only import breaks dependency
  injection at runtime).
- Vitest transforms tests with SWC (`unplugin-swc`) so decorator metadata is
  emitted in tests just like in the `tsc`/`nest build` output.
- Sessions are stored in PostgreSQL; there is no out-of-band revocation
  channel yet (logout/revocation are checked on every request).

## Test data hygiene

Integration tests create synthetic identities (`*@socc.test`) and clean them
up per suite; `test/integration/global-setup.ts` additionally purges leftovers
from interrupted runs before test workers start, applies
`prisma migrate deploy` (never reset/drop), and fails loudly with a
`BLOCKED:` error when PostgreSQL is unreachable (tests are reported as
blocked, never silently skipped).
