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

async function addAnalyst(
  organizationId: string,
  analystEmail: string,
  analystName: string,
  passwordHash: string,
): Promise<void> {
  const analystUserId = await ensureUser(analystEmail, analystName, passwordHash);
  const existing = await prisma.organizationMembership.findUnique({
    where: { organizationId_userId: { organizationId, userId: analystUserId } },
  });
  if (existing) return;
  const analystRole = await prisma.role.findUniqueOrThrow({
    where: { name: "SECURITY_ANALYST" },
  });
  await prisma.organizationMembership.create({
    data: {
      organizationId,
      userId: analystUserId,
      status: "ACTIVE",
      roles: { create: [{ roleId: analystRole.id }] },
    },
  });
}

async function main(): Promise<void> {
  const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });

  const orgA = await ensureOrgWithOwner(
    "Alpha Security (synthetic)",
    "alice@orga.socc.test",
    "Alice Owner (synthetic)",
    passwordHash,
  );
  await ensureOrgWithOwner(
    "Bravo Security (synthetic)",
    "bob@orgb.socc.test",
    "Bob Owner (synthetic)",
    passwordHash,
  );
  await addAnalyst(
    orgA,
    "analyst@orga.socc.test",
    "Ana Analyst (synthetic)",
    passwordHash,
  );

  console.info("Seed complete (synthetic dev data).");
  console.info("  alice@orga.socc.test / bob@orgb.socc.test / analyst@orga.socc.test");
  console.info(`  password (dev only): ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
