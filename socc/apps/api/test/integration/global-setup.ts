import { execSync } from "node:child_process";
import { createConnection } from "node:net";
import { PrismaClient } from "@prisma/client";
import { loadTestEnv } from "../test-env.js";

/**
 * Integration-test global setup:
 * 1. Loads the SOCC env file.
 * 2. Verifies PostgreSQL is reachable (fails loudly if not — tests are
 *    reported as blocked rather than silently skipped).
 * 3. Applies pending migrations with `prisma migrate deploy` (never
 *    resets or drops data).
 */
export default async function globalSetup(): Promise<void> {
  loadTestEnv();

  const rawUrl = process.env.SOC_APP_DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      "BLOCKED: SOC_APP_DATABASE_URL is not configured. Copy .env.example to apps/api/.env.",
    );
  }
  const url = new URL(rawUrl);
  const host = url.hostname || "localhost";
  const port = Number(url.port || 5432);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const socket = createConnection({ host, port }, () => {
      socket.end();
      resolvePromise();
    });
    socket.setTimeout(5000, () => {
      socket.destroy();
      rejectPromise(
        new Error(
          `BLOCKED: PostgreSQL is not reachable at ${host}:${port}. ` +
            `Start the SOCC-owned database with 'pnpm db:up' from the repository root.`,
        ),
      );
    });
    socket.on("error", (err) => {
      rejectPromise(
        new Error(
          `BLOCKED: PostgreSQL is not reachable at ${host}:${port}. ` +
            `Start the SOCC-owned database with 'pnpm db:up' from the repository root. ` +
            `(${err.message})`,
        ),
      );
    });
  });

  execSync("pnpm exec prisma migrate deploy", {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env,
  });

  await purgeLeftoverFixtures();
}

/**
 * Removes synthetic fixtures (@socc.test users and their organizations)
 * left behind by a previous, interrupted test run. Runs before test workers
 * start, using the owner role (never the runtime role).
 */
async function purgeLeftoverFixtures(): Promise<void> {
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) return;

  const prisma = new PrismaClient({ datasourceUrl: ownerUrl });
  try {
    const users = await prisma.user.findMany({
      where: { normalizedEmail: { endsWith: "@socc.test" } },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return;

    const memberships = await prisma.organizationMembership.findMany({
      where: { userId: { in: userIds } },
      select: { organizationId: true },
    });
    const organizationIds = [...new Set(memberships.map((m) => m.organizationId))];

    if (organizationIds.length > 0) {
      await prisma.auditLog.deleteMany({
        where: { organizationId: { in: organizationIds } },
      });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
    }
    await prisma.auditLog.deleteMany({
      where: { actorId: { in: userIds } },
    });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  } finally {
    await prisma.$disconnect();
  }
}
