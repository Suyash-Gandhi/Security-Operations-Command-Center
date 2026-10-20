-- RLS defense-in-depth, least-privilege grants, and role/permission catalog.
--
-- Rollback notes: DROP POLICYs, ALTER TABLE ... DISABLE ROW LEVEL SECURITY,
-- REVOKE grants, and DELETE the seeded Role/Permission rows by the fixed IDs
-- below. No application data is modified by this migration.

-- ---------------------------------------------------------------------------
-- 1) Permission catalog and role mappings (deterministic IDs)
-- ---------------------------------------------------------------------------

INSERT INTO "Permission" (id, code, description, "createdAt") VALUES
  ('a0000000-0000-4000-8000-000000000001', 'org:read', 'Read the current organization', NOW()),
  ('a0000000-0000-4000-8000-000000000002', 'org:update', 'Update organization settings', NOW()),
  ('a0000000-0000-4000-8000-000000000003', 'org:members:read', 'List organization members', NOW()),
  ('a0000000-0000-4000-8000-000000000004', 'org:members:write', 'Add or modify organization members', NOW()),
  ('a0000000-0000-4000-8000-000000000005', 'audit:read', 'Read audit records', NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "Role" (id, name, description, "createdAt", "updatedAt") VALUES
  ('b0000000-0000-4000-8000-000000000001', 'OWNER', 'Organization owner: full control over the organization', NOW(), NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'SECURITY_ADMIN', 'Security administrator: manages members and security configuration', NOW(), NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'SECURITY_ANALYST', 'Security analyst: investigates alerts and incidents', NOW(), NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'INCIDENT_LEAD', 'Incident lead: coordinates assignment and escalation', NOW(), NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'AUDITOR', 'Auditor: reads permitted audit and investigation records', NOW(), NOW()),
  ('b0000000-0000-4000-8000-000000000006', 'VIEWER', 'Viewer: reads explicitly permitted records', NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt") VALUES
  -- OWNER: all permissions
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', NOW()),
  -- SECURITY_ADMIN
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000003', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000005', NOW()),
  -- SECURITY_ANALYST
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000005', NOW()),
  -- INCIDENT_LEAD
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000003', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000005', NOW()),
  -- AUDITOR
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000005', NOW()),
  -- VIEWER
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000001', NOW()),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000003', NOW())
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Least-privilege grants for the runtime application role (socc_app).
--    The API never connects as the table owner, so RLS is enforced.
-- ---------------------------------------------------------------------------

GRANT USAGE ON SCHEMA public TO socc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO socc_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO socc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE socc_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO socc_app;
ALTER DEFAULT PRIVILEGES FOR ROLE socc_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO socc_app;

-- Audit records are append-only for the application role.
REVOKE UPDATE, DELETE ON "AuditLog" FROM socc_app;

-- ---------------------------------------------------------------------------
-- 3) Row-Level Security (defense in depth behind application authorization)
-- ---------------------------------------------------------------------------

ALTER TABLE "OrganizationMembership" ENABLE ROW LEVEL SECURITY;

-- Members may always see their own memberships (needed before an
-- organization context exists); once an organization context is verified,
-- all memberships of that organization become visible.
CREATE POLICY membership_select ON "OrganizationMembership"
  FOR SELECT USING (
    "userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

-- Writes are only permitted against the organization established as trusted
-- tenant context (never for arbitrary organizations).
CREATE POLICY membership_write ON "OrganizationMembership"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;

-- Audit rows are readable only within their organization context.
-- Login events (organizationId IS NULL) are write-only for the app role.
CREATE POLICY audit_log_select ON "AuditLog"
  FOR SELECT USING (
    "organizationId" IS NOT NULL
    AND "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

CREATE POLICY audit_log_insert ON "AuditLog"
  FOR INSERT WITH CHECK (
    "organizationId" IS NULL
    OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );
