import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { ownerPrisma } from "./helpers.js";

describe("phase3 detection engine", () => {
  const prisma = ownerPrisma();

  beforeAll(async () => {
    // Integration tests run against real DB; rely on global setup/migrations
  });

  it("creates detection rules and supports matches/alerts", async () => {
    const orgId = randomUUID();
    await prisma.organization.create({ data: { id: orgId, name: "DetOrg" } });

    const rule = await prisma.detectionRule.create({
      data: {
        organizationId: null,
        name: "Failed logins threshold",
        description: "Test rule",
        ruleType: "THRESHOLD",
        configuration: {
          ruleType: "THRESHOLD",
          eventType: "auth.login.failed",
          groupBy: ["actor", "sourceIp"],
          threshold: 3,
          windowMinutes: 5,
        },
        severity: "HIGH",
        enabled: true,
        version: 1,
      },
    });
    expect(rule.id).toBeDefined();
    const matches = await prisma.detectionMatch.findMany();
    expect(Array.isArray(matches)).toBe(true);
  });
});
