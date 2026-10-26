import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import type { PrismaClient } from "@prisma/client";
import {
  ApiClient,
  cleanupSynthetic,
  createTestApp,
  ownerPrisma,
  registerUser,
} from "./helpers.js";

describe("tenant isolation between two organizations", () => {
  let app: INestApplication;
  let server: Server;
  let owner: PrismaClient;

  const userIds: string[] = [];
  const orgIds: string[] = [];

  let ownerAClient: ApiClient;
  let ownerBClient: ApiClient;
  let orgA: string;
  let orgB: string;
  let orgAMembershipIds: string[];
  let orgBMembershipIds: string[];

  beforeAll(async () => {
    ({ app, server } = await createTestApp());
    owner = ownerPrisma();

    ownerAClient = new ApiClient(server);
    const a1 = await registerUser(ownerAClient, "isoA1");
    userIds.push(a1.userId);
    orgIds.push(a1.organizationId);
    orgA = a1.organizationId;

    const a2 = await registerUser(new ApiClient(server), "isoA2");
    userIds.push(a2.userId);
    orgIds.push(a2.organizationId);
    await ownerAClient.post(
      "/v1/organizations/current/members",
      { email: a2.email, roles: ["SECURITY_ANALYST"] },
      orgA,
    );

    ownerBClient = new ApiClient(server);
    const b1 = await registerUser(ownerBClient, "isoB1");
    userIds.push(b1.userId);
    orgIds.push(b1.organizationId);
    orgB = b1.organizationId;

    const b2 = await registerUser(new ApiClient(server), "isoB2");
    userIds.push(b2.userId);
    orgIds.push(b2.organizationId);
    await ownerBClient.post(
      "/v1/organizations/current/members",
      { email: b2.email, roles: ["SECURITY_ANALYST"] },
      orgB,
    );

    const membersA = await ownerAClient.get("/v1/organizations/current/members", orgA);
    orgAMembershipIds = (membersA.body.members as Array<{ membershipId: string }>).map(
      (m) => m.membershipId,
    );
    const membersB = await ownerBClient.get("/v1/organizations/current/members", orgB);
    orgBMembershipIds = (membersB.body.members as Array<{ membershipId: string }>).map(
      (m) => m.membershipId,
    );
  });

  afterAll(async () => {
    if (app && typeof (app as { close?: () => Promise<void> }).close === "function") {
      try {
        await (app as { close: () => Promise<void> }).close();
      } catch {
        // ignore cleanup errors
      }
    }
    if (owner) {
      try {
        await cleanupSynthetic(owner, userIds, orgIds);
      } catch {
        // ignore cleanup errors
      }
      try {
        await owner.$disconnect();
      } catch {
        // ignore cleanup errors
      }
    }
  });

  it("each organization only lists its own members", async () => {
    const a = await ownerAClient.get("/v1/organizations/current/members", orgA);
    const b = await ownerBClient.get("/v1/organizations/current/members", orgB);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const aIds = (a.body.members as Array<{ membershipId: string }>).map(
      (m) => m.membershipId,
    );
    const bIds = (b.body.members as Array<{ membershipId: string }>).map(
      (m) => m.membershipId,
    );
    expect(aIds).toHaveLength(2);
    expect(bIds).toHaveLength(2);
    expect(aIds.some((id) => bIds.includes(id))).toBe(false);
  });

  it("cross-organization reads are concealed as not found", async () => {
    const asBReadsA = await ownerBClient.get("/v1/organizations/current", orgA);
    expect(asBReadsA.status).toBe(404);
    expect(asBReadsA.body.code).toBe("ORG_NOT_FOUND");

    const asAReadsB = await ownerAClient.get("/v1/organizations/current/members", orgB);
    expect(asAReadsB.status).toBe(404);
    expect(asAReadsB.body.code).toBe("ORG_NOT_FOUND");
  });

  it("tampering with X-Organization-Id does not grant access", async () => {
    const res = await ownerBClient.get("/v1/organizations/current/members", orgA);
    expect(res.status).toBe(404);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("@socc.test");
    expect(raw).not.toContain("Synthetic");
  });

  it("cross-organization resource ids cannot be mutated", async () => {
    const res = await ownerBClient.patch(
      `/v1/organizations/current/members/${orgAMembershipIds[0]}`,
      { status: "REVOKED" },
      orgB,
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MEMBER_NOT_FOUND");

    const unchanged = await ownerAClient.get("/v1/organizations/current/members", orgA);
    const ids = (unchanged.body.members as Array<{ membershipId: string }>).map(
      (m) => m.membershipId,
    );
    expect(ids).toContain(orgAMembershipIds[0]);
  });

  it("organization ids in request bodies are rejected as unknown fields", async () => {
    const res = await ownerBClient.post("/v1/organizations/current/members", {
      email: `tamper-${Date.now()}@socc.test`,
      roles: ["VIEWER"],
      organizationId: orgA,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("a user with no active membership cannot reach organization endpoints", async () => {
    const res = await ownerAClient.get(
      "/v1/organizations/current",
      "c0000000-0000-4000-8000-000000000099",
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ORG_NOT_FOUND");
    expect(orgBMembershipIds.length).toBeGreaterThan(0);
  });

  it("only shows the caller their own organizations", async () => {
    const listA = await ownerAClient.get("/v1/organizations");
    const listB = await ownerBClient.get("/v1/organizations");
    const aOrgIds = (listA.body.organizations as Array<{ organizationId: string }>).map(
      (o) => o.organizationId,
    );
    const bOrgIds = (listB.body.organizations as Array<{ organizationId: string }>).map(
      (o) => o.organizationId,
    );
    expect(aOrgIds).toContain(orgA);
    expect(aOrgIds).not.toContain(orgB);
    expect(bOrgIds).toContain(orgB);
    expect(bOrgIds).not.toContain(orgA);
  });
});
