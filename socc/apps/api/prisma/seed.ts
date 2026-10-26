/**
 * Development-only seed data (synthetic).
 *
 * Creates two organizations with separate owners and one analyst so tenant
 * isolation can be verified manually. Passwords are synthetic dev values and
 * must never be used outside local development.
 *
 * Run: pnpm --filter @socc/api db:seed
 */
import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEV_PASSWORD = "SeedDevPassword!2024";

async function ensureUser(
  email: string,
  displayName: string,
  passwordHash: string,
): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { normalizedEmail: email } });
  if (existing) return existing.id;
  const id = randomUUID();
  await prisma.user.create({
    data: { id, normalizedEmail: email, displayName, passwordHash },
  });
  return id;
}

async function ensureOrgWithOwner(
  orgName: string,
  ownerEmail: string,
  ownerName: string,
  passwordHash: string,
): Promise<string> {
  const ownerUserId = await ensureUser(ownerEmail, ownerName, passwordHash);
  const memberships = await prisma.organizationMembership.findMany({
    where: { userId: ownerUserId },
    include: { organization: true },
  });
  const existingOrg = memberships.find((m) => m.organization.name === orgName);
  if (existingOrg) return existingOrg.organizationId;

  const organizationId = randomUUID();
  const ownerRole = await prisma.role.findUniqueOrThrow({ where: { name: "OWNER" } });
  await prisma.organization.create({
    data: { id: organizationId, name: orgName },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId,
      userId: ownerUserId,
      status: "ACTIVE",
      roles: { create: [{ roleId: ownerRole.id }] },
    },
  });
  return organizationId;
}

async function ensureDetectionRules(): Promise<void> {
  const existing = await prisma.detectionRule.findFirst({
    where: { name: "Repeated failed logins" },
  });
  if (existing) return;
  await prisma.detectionRule.create({
    data: {
      organizationId: null,
      name: "Repeated failed logins",
      description:
        "Detect multiple failed authentication attempts from same actor/source",
      ruleType: "THRESHOLD",
      configuration: {
        ruleType: "THRESHOLD",
        eventType: "auth.login.failed",
        groupBy: ["actor", "sourceIp"],
        threshold: 5,
        windowMinutes: 5,
      },
      severity: "HIGH",
      enabled: true,
      version: 1,
    },
  });
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEV_PASSWORD);
  const org1 = await ensureOrgWithOwner(
    "Acme Corp",
    "owner@acme.example",
    "Acme Owner",
    passwordHash,
  );
  const org2 = await ensureOrgWithOwner(
    "Globex",
    "owner@globex.example",
    "Globex Owner",
    passwordHash,
  );

  const analystId = await ensureUser(
    "analyst@acme.example",
    "Acme Analyst",
    passwordHash,
  );
  const analystRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SECURITY_ANALYST" },
  });
  const existingAnalystMembership = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId: org1, userId: analystId } },
  });
  if (!existingAnalystMembership) {
    await prisma.organizationMembership.create({
      data: {
        organizationId: org1,
        userId: analystId,
        status: "ACTIVE",
        roles: { create: [{ roleId: analystRole.id }] },
      },
    });
  }

  await ensureDetectionRules();

  console.log("Seed complete");
  console.log(`Acme Corp org: ${org1}`);
  console.log(`Globex org: ${org2}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
