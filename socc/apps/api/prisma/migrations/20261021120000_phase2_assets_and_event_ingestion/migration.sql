-- Phase 2: asset inventory, event sources, event ingestion, and the
-- transactional outbox. Additive only; no existing Phase 1 data is modified.
--
-- Rollback notes: DROP the new RLS policies, disable RLS on the new tables,
-- DELETE the seeded Permission/RolePermission rows by the fixed IDs below,
-- then DROP TABLE in reverse dependency order:
--   "IdempotencyRecord", "OutboxMessage", "SecurityEvent", "EventBatch",
--   "EventSource", "Asset"; finally DROP the three new enums.

-- ---------------------------------------------------------------------------
-- 1) Enums and tables
-- ---------------------------------------------------------------------------

CREATE TYPE "AssetStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "EventSourceStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "EventBatchStatus" AS ENUM ('ACCEPTED', 'COMPLETED', 'REJECTED');

CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "assetType" TEXT NOT NULL,
    "hostname" TEXT,
    "environment" TEXT,
    "criticality" TEXT,
    "owner" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventSource" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "status" "EventSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastEventAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EventSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventBatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "status" "EventBatchStatus" NOT NULL DEFAULT 'ACCEPTED',
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "EventBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SecurityEvent" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "assetId" UUID,
    "sourceEventId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "eventType" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" TEXT,
    "actor" TEXT,
    "sourceIp" TEXT,
    "normalizedPayload" JSONB NOT NULL,
    "rawPayloadReference" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OutboxMessage" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" UUID NOT NULL,
    "messageType" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutboxMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resourceReference" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- 2) Indexes and foreign keys
-- ---------------------------------------------------------------------------

CREATE INDEX "Asset_organizationId_status_idx" ON "Asset"("organizationId", "status");
CREATE INDEX "Asset_organizationId_hostname_idx" ON "Asset"("organizationId", "hostname");
CREATE INDEX "Asset_organizationId_name_idx" ON "Asset"("organizationId", "name");

CREATE UNIQUE INDEX "EventSource_credentialHash_key" ON "EventSource"("credentialHash");
CREATE INDEX "EventSource_organizationId_status_idx" ON "EventSource"("organizationId", "status");

CREATE INDEX "EventBatch_organizationId_createdAt_idx" ON "EventBatch"("organizationId", "createdAt" DESC);
CREATE INDEX "EventBatch_organizationId_status_idx" ON "EventBatch"("organizationId", "status");
CREATE INDEX "EventBatch_sourceId_idx" ON "EventBatch"("sourceId");

CREATE INDEX "SecurityEvent_organizationId_eventTime_id_idx" ON "SecurityEvent"("organizationId", "eventTime" DESC, "id");
CREATE INDEX "SecurityEvent_organizationId_eventType_eventTime_idx" ON "SecurityEvent"("organizationId", "eventType", "eventTime" DESC);
CREATE INDEX "SecurityEvent_organizationId_sourceId_eventTime_idx" ON "SecurityEvent"("organizationId", "sourceId", "eventTime" DESC);
CREATE INDEX "SecurityEvent_assetId_idx" ON "SecurityEvent"("assetId");
CREATE UNIQUE INDEX "SecurityEvent_organizationId_sourceId_dedupeKey_key" ON "SecurityEvent"("organizationId", "sourceId", "dedupeKey");

CREATE INDEX "OutboxMessage_organizationId_publishedAt_createdAt_idx" ON "OutboxMessage"("organizationId", "publishedAt", "createdAt");
CREATE INDEX "OutboxMessage_publishedAt_nextAttemptAt_idx" ON "OutboxMessage"("publishedAt", "nextAttemptAt");

CREATE INDEX "IdempotencyRecord_organizationId_expiresAt_idx" ON "IdempotencyRecord"("organizationId", "expiresAt");
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_idempotencyKey_key" ON "IdempotencyRecord"("organizationId", "idempotencyKey");

ALTER TABLE "Asset" ADD CONSTRAINT "Asset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventSource" ADD CONSTRAINT "EventSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventBatch" ADD CONSTRAINT "EventBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventBatch" ADD CONSTRAINT "EventBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EventSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EventSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "EventBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OutboxMessage" ADD CONSTRAINT "OutboxMessage_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3) Phase 2 permission catalog and role mappings (deterministic IDs)
-- ---------------------------------------------------------------------------

INSERT INTO "Permission" (id, code, description, "createdAt") VALUES
  ('a0000000-0000-4000-8000-000000000006', 'assets:read', 'Read assets in the current organization', NOW()),
  ('a0000000-0000-4000-8000-000000000007', 'assets:write', 'Create and update assets in the current organization', NOW()),
  ('a0000000-0000-4000-8000-000000000008', 'event_sources:read', 'Read event sources in the current organization', NOW()),
  ('a0000000-0000-4000-8000-000000000009', 'event_sources:write', 'Manage event sources and their credentials', NOW()),
  ('a0000000-0000-4000-8000-000000000010', 'events:read', 'Read ingested events and batch status', NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt") VALUES
  -- OWNER: all Phase 2 permissions
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000007', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000008', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000009', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000010', NOW()),
  -- SECURITY_ADMIN: manages assets and event sources
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000007', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000008', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000009', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000010', NOW()),
  -- SECURITY_ANALYST: read-only context
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000008', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000010', NOW()),
  -- INCIDENT_LEAD: read-only context
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000008', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000010', NOW()),
  -- AUDITOR: audit-friendly read-only context
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000008', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000010', NOW()),
  -- VIEWER: assets and events only
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000006', NOW()),
  ('b0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000010', NOW())
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Least-privilege grants for the runtime application role
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON
  "Asset", "EventSource", "EventBatch", "SecurityEvent",
  "OutboxMessage", "IdempotencyRecord"
TO socc_app;

-- ---------------------------------------------------------------------------
-- 5) Row-Level Security (defense in depth behind application authorization)
-- ---------------------------------------------------------------------------

ALTER TABLE "Asset" ENABLE ROW LEVEL SECURITY;
CREATE POLICY asset_tenant ON "Asset"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "EventSource" ENABLE ROW LEVEL SECURITY;

-- Source authentication happens before an organization context is known.
-- A caller may only select the source row whose stored credential hash
-- matches the transaction-local hash of the presented credential; all other
-- access requires the trusted organization GUC.
CREATE POLICY event_source_select ON "EventSource"
  FOR SELECT USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    OR "credentialHash" = NULLIF(current_setting('app.current_source_credential_hash', true), '')
  );
CREATE POLICY event_source_write ON "EventSource"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "EventBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY event_batch_tenant ON "EventBatch"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "SecurityEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_event_tenant ON "SecurityEvent"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "OutboxMessage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbox_message_tenant ON "OutboxMessage"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "IdempotencyRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY idempotency_record_tenant ON "IdempotencyRecord"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

-- ---------------------------------------------------------------------------
-- 6) Outbox worker functions
-- ---------------------------------------------------------------------------
-- The outbox publisher must see pending messages across every tenant without
-- being granted a session-wide RLS bypass. These SECURITY DEFINER functions are
-- owned by the migration role (which owns the tables) and are the only
-- cross-tenant path exposed to the runtime role. Claiming leases a message by
-- incrementing attemptCount and pushing nextAttemptAt forward, so concurrent
-- publishers skip it and crashed publishers retry later.

CREATE OR REPLACE FUNCTION socc_claim_outbox(p_limit integer DEFAULT 50)
RETURNS SETOF "OutboxMessage"
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE "OutboxMessage"
  SET "attemptCount" = "attemptCount" + 1,
      "nextAttemptAt" = now() + interval '30 seconds'
  WHERE "id" IN (
    SELECT "id" FROM "OutboxMessage"
    WHERE "publishedAt" IS NULL
      AND "nextAttemptAt" <= now()
    ORDER BY "createdAt"
    LIMIT greatest(0, least(p_limit, 500))
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION socc_mark_outbox_published(p_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE "OutboxMessage"
  SET "publishedAt" = now(),
      "lastError" = NULL
  WHERE "id" = p_id AND "publishedAt" IS NULL;
$$;

CREATE OR REPLACE FUNCTION socc_mark_outbox_failed(
  p_id uuid,
  p_error text,
  p_next_attempt_at timestamptz
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE "OutboxMessage"
  SET "lastError" = left(p_error, 1000),
      "nextAttemptAt" = p_next_attempt_at
  WHERE "id" = p_id AND "publishedAt" IS NULL;
$$;

REVOKE ALL ON FUNCTION socc_claim_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION socc_mark_outbox_published(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION socc_mark_outbox_failed(uuid, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION socc_claim_outbox(integer) TO socc_app;
GRANT EXECUTE ON FUNCTION socc_mark_outbox_published(uuid) TO socc_app;
GRANT EXECUTE ON FUNCTION socc_mark_outbox_failed(uuid, text, timestamptz) TO socc_app;
