import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { appRolePrisma, ownerPrisma } from "./helpers.js";

/**
 * Verifies PostgreSQL Row-Level Security through the actual runtime database
 * role (socc_app), not just through the application layer.
 */
describe("PostgreSQL RLS defense in depth", () => {
  let appRole: PrismaClient;
  let owner: PrismaClient;

  const userIds: string[] = [];
  const orgIds: string[] = [];
  const nullOrgAuditIds: string[] = [];
  let orgA: string;
  let orgB: string;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    appRole = appRolePrisma();
    owner = ownerPrisma();

    orgA = randomUUID();
    orgB = randomUUID();
    userA = randomUUID();
    userB = randomUUID();
    orgIds.push(orgA, orgB);
    userIds.push(userA, userB);

    await owner.organization.createMany({
      data: [
        { id: orgA, name: "RLS Org A (synthetic)" },
        { id: orgB, name: "RLS Org B (synthetic)" },
      ],
    });
    await owner.user.createMany({
      data: [
        {
          id: userA,
          normalizedEmail: "rls-a@socc.test",
          displayName: "RLS A",
          passwordHash: "not-a-real-hash-synthetic",
        },
        {
          id: userB,
          normalizedEmail: "rls-b@socc.test",
          displayName: "RLS B",
          passwordHash: "not-a-real-hash-synthetic",
        },
      ],
    });
    await owner.organizationMembership.createMany({
      data: [
        { organizationId: orgA, userId: userA },
        { organizationId: orgB, userId: userB },
      ],
    });
  });

  afterAll(async () => {
    await owner.auditLog.deleteMany({
      where: {
        OR: [{ organizationId: { in: orgIds } }, { id: { in: nullOrgAuditIds } }],
      },
    });
    await owner.organization.deleteMany({ where: { id: { in: orgIds } } });
    await owner.user.deleteMany({ where: { id: { in: userIds } } });
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  it("app role sees no memberships without tenant context", async () => {
    const rows = await appRole.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*)::bigint AS count FROM "OrganizationMembership"`;
    expect(rows[0]?.count).toBe(0n);
  });

  it("user GUC only exposes that user's memberships", async () => {
    const rows = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userA}, true)`;
      return tx.$queryRaw<
        Array<{ organizationId: string }>
      >`SELECT "organizationId" FROM "OrganizationMembership"`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["organizationId"]).toBe(orgA);
  });

  it("organization GUC only exposes that organization's memberships", async () => {
    const rows = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${orgB}, true)`;
      return tx.$queryRaw<
        Array<{ organizationId: string; userId: string }>
      >`SELECT "organizationId", "userId" FROM "OrganizationMembership"`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["organizationId"]).toBe(orgB);
    expect(rows[0]?.["userId"]).toBe(userB);
  });

  it("writes outside the trusted organization are rejected by RLS", async () => {
    await expect(
      appRole.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${orgA}, true)`;
        await tx.$executeRaw`INSERT INTO "OrganizationMembership" (id, "organizationId", "userId", status, "createdAt", "updatedAt") VALUES (${randomUUID()}, ${orgB}, ${userA}, 'ACTIVE', now(), now())`;
      }),
    ).rejects.toThrow();
  });

  it("login-style audit rows (null organization) are insertable but not readable by the app role", async () => {
    const insertedId = randomUUID();
    await appRole.$executeRaw`
      INSERT INTO "AuditLog" ("id", "action", "resourceType", "organizationId", "actorId", "occurredAt")
      VALUES (${insertedId}::uuid, 'auth.login', 'user', NULL, NULL, now())`;
    nullOrgAuditIds.push(insertedId);

    const rows = await appRole.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*)::bigint AS count FROM "AuditLog"`;
    expect(rows[0]?.count).toBe(0n);
  });

  it("organization-scoped audit rows are only visible under their organization GUC", async () => {
    await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${orgA}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userA}, true)`;
      await tx.auditLog.create({
        data: {
          action: "member.added",
          resourceType: "organization_membership",
          organizationId: orgA,
          actorId: userA,
        },
      });
    });

    const asA = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${orgA}, true)`;
      return tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM "AuditLog"`;
    });
    expect(asA[0]?.count).toBe(1n);

    const asB = await appRole.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_organization_id', ${orgB}, true)`;
      return tx.$queryRaw<
        Array<{ count: bigint }>
      >`SELECT count(*)::bigint AS count FROM "AuditLog"`;
    });
    expect(asB[0]?.count).toBe(0n);
  });

  it("audit rows are append-only for the app role (no UPDATE/DELETE)", async () => {
    await expect(
      appRole.$executeRaw`UPDATE "AuditLog" SET action = 'tampered'`,
    ).rejects.toThrow(/permission denied/i);

    await expect(appRole.$executeRaw`DELETE FROM "AuditLog"`).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("the table owner bypasses RLS, which is why the app never connects as owner", async () => {
    const rows = await owner.$queryRaw<
      Array<{ count: bigint }>
    >`SELECT count(*)::bigint AS count FROM "OrganizationMembership"`;
    expect(rows[0]?.count).toBeGreaterThanOrEqual(2n);
  });
});
