-- CreateEnum
CREATE TYPE "DetectionRuleType" AS ENUM ('THRESHOLD', 'SEQUENCE');

-- CreateEnum
CREATE TYPE "DetectionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

-- CreateTable
CREATE TABLE "DetectionRule" (
    "id" UUID NOT NULL,
    "organizationId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ruleType" "DetectionRuleType" NOT NULL,
    "configuration" JSONB NOT NULL,
    "severity" "DetectionSeverity" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DetectionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectionMatch" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "matchKey" TEXT NOT NULL,
    "eventId" UUID NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evidence" JSONB NOT NULL,

    CONSTRAINT "DetectionMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "severity" "DetectionSeverity" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "count" INTEGER NOT NULL DEFAULT 1,
    "assetId" UUID,
    "primaryEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "alertId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("alertId","eventId")
);

-- CreateIndex
CREATE INDEX "DetectionRule_organizationId_enabled_idx" ON "DetectionRule"("organizationId", "enabled");

-- CreateIndex
CREATE INDEX "DetectionRule_enabled_idx" ON "DetectionRule"("enabled");

-- CreateIndex
CREATE INDEX "DetectionMatch_organizationId_matchedAt_idx" ON "DetectionMatch"("organizationId", "matchedAt" DESC);

-- CreateIndex
CREATE INDEX "DetectionMatch_ruleId_idx" ON "DetectionMatch"("ruleId");

-- CreateIndex
CREATE INDEX "DetectionMatch_eventId_idx" ON "DetectionMatch"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "DetectionMatch_organizationId_ruleId_matchKey_key" ON "DetectionMatch"("organizationId", "ruleId", "matchKey");

-- CreateIndex
CREATE INDEX "Alert_organizationId_status_severity_lastSeenAt_idx" ON "Alert"("organizationId", "status", "severity", "lastSeenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Alert_organizationId_ruleId_matchKey_key" ON "Alert"("organizationId", "ruleId", "matchKey");

-- AddForeignKey
ALTER TABLE "DetectionRule" ADD CONSTRAINT "DetectionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionMatch" ADD CONSTRAINT "DetectionMatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionMatch" ADD CONSTRAINT "DetectionMatch_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DetectionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectionMatch" ADD CONSTRAINT "DetectionMatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SecurityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "DetectionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SecurityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions for detection and alerts
INSERT INTO "Permission" (id, code, description, "createdAt") VALUES
  ('b0000000-0000-4000-8000-000000000011', 'detection_rules:read', 'Read detection rules', NOW()),
  ('b0000000-0000-4000-8000-000000000012', 'detection_rules:write', 'Manage detection rules', NOW()),
  ('b0000000-0000-4000-8000-000000000013', 'alerts:read', 'Read alerts and detection matches', NOW()),
  ('b0000000-0000-4000-8000-000000000014', 'alerts:write', 'Update alerts', NOW())
ON CONFLICT (code) DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId", "createdAt") VALUES
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000012', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000013', NOW()),
  ('b0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000014', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000012', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000013', NOW()),
  ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000014', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000013', NOW()),
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000014', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000013', NOW()),
  ('b0000000-0000-4000-8000-000000000004', 'b0000000-0000-4000-8000-000000000014', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000005', 'b0000000-0000-4000-8000-000000000013', NOW()),
  ('b0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000011', NOW()),
  ('b0000000-0000-4000-8000-000000000006', 'b0000000-0000-4000-8000-000000000013', NOW())
ON CONFLICT ("roleId", "permissionId") DO NOTHING;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "DetectionRule", "DetectionMatch", "Alert", "AlertEvent"
TO socc_app;

-- RLS
ALTER TABLE "DetectionRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY detection_rule_tenant ON "DetectionRule"
  FOR ALL USING (
    "organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" IS NULL OR "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "DetectionMatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY detection_match_tenant ON "DetectionMatch"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "Alert" ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_tenant ON "Alert"
  FOR ALL USING (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
  );

ALTER TABLE "AlertEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY alert_event_tenant ON "AlertEvent"
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM "Alert" a
      WHERE a.id = "AlertEvent"."alertId"
        AND a."organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "Alert" a
      WHERE a.id = "AlertEvent"."alertId"
        AND a."organizationId" = NULLIF(current_setting('app.current_organization_id', true), '')::uuid
    )
  );
