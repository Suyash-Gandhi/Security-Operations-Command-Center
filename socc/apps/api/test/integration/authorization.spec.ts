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

describe("organization membership and authorization", () => {
  let app: INestApplication;
  let server: Server;
  let owner: PrismaClient;

  const userIds: string[] = [];
  const orgIds: string[] = [];

  let ownerAClient: ApiClient;
  let adminAClient: ApiClient;
  let analystAClient: ApiClient;
  let ownerBClient: ApiClient;
  let orgA: string;
  let orgB: string;
  let ownerAMembershipId: string;
  let analystAMembershipId: string;
  let adminEmail: string;

  beforeAll(async () => {
    ({ app, server } = await createTestApp());
    owner = ownerPrisma();

    ownerAClient = new ApiClient(server);
    const a = await registerUser(ownerAClient, "ownerA");
    userIds.push(a.userId);
    orgIds.push(a.organizationId);
    orgA = a.organizationId;

    adminAClient = new ApiClient(server);
    const adminA = await registerUser(adminAClient, "adminA");
    userIds.push(adminA.userId);
    orgIds.push(adminA.organizationId);
    adminEmail = adminA.email;

    analystAClient = new ApiClient(server);
    const analystA = await registerUser(analystAClient, "analystA");
    userIds.push(analystA.userId);
    orgIds.push(analystA.organizationId);

    ownerBClient = new ApiClient(server);
    const b = await registerUser(ownerBClient, "ownerB");
    userIds.push(b.userId);
    orgIds.push(b.organizationId);
    orgB = b.organizationId;

    const adminAdd = await ownerAClient.post(
      "/v1/organizations/current/members",
      { email: adminA.email, roles: ["SECURITY_ADMIN"] },
      orgA,
    );
    expect(adminAdd.status).toBe(201);

    const analystAdd = await ownerAClient.post(
      "/v1/organizations/current/members",
      { email: analystA.email, roles: ["SECURITY_ANALYST"] },
      orgA,
    );
    expect(analystAdd.status).toBe(201);
    analystAMembershipId = analystAdd.body.membershipId;

    const members = await ownerAClient.get("/v1/organizations/current/members", orgA);
    ownerAMembershipId = members.body.members.find(
      (m: { email: string }) => m.email === a.email,
    ).membershipId;
  });

  afterAll(async () => {
    await app.close();
    await cleanupSynthetic(owner, userIds, orgIds);
    await owner.$disconnect();
  });

  it("lists members within the authorized organization", async () => {
    const res = await ownerAClient.get("/v1/organizations/current/members", orgA);
    expect(res.status).toBe(200);
    const memberList = res.body.members as Array<{ email: string; roles: string[] }>;
    expect(memberList).toHaveLength(3);
    const analyst = memberList.find((m) => m.roles.includes("SECURITY_ANALYST"));
    expect(analyst).toBeTruthy();
    const admin = memberList.find((m) => m.roles.includes("SECURITY_ADMIN"));
    expect(admin).toBeTruthy();
    const orgOwner = memberList.find((m) => m.roles.includes("OWNER"));
    expect(orgOwner).toBeTruthy();
  });

  it("requires a verified organization context header", async () => {
    const missing = await ownerAClient.get("/v1/organizations/current");
    expect(missing.status).toBe(400);

    const malformed = await ownerAClient.get("/v1/organizations/current", "not-a-uuid");
    expect(malformed.status).toBe(400);
    expect(malformed.body.code).toBe("VALIDATION_ERROR");
  });

  it("enforces permissions: analyst may read members but not modify them", async () => {
    const read = await analystAClient.get("/v1/organizations/current/members", orgA);
    expect(read.status).toBe(200);

    const write = await analystAClient.post(
      "/v1/organizations/current/members",
      { email: `stranger-${Date.now()}@socc.test`, roles: ["VIEWER"] },
      orgA,
    );
    expect(write.status).toBe(403);
    expect(write.body.code).toBe("FORBIDDEN");
  });

  it("prevents privilege escalation: admin cannot grant OWNER", async () => {
    const res = await adminAClient.patch(
      `/v1/organizations/current/members/${analystAMembershipId}`,
      { roles: ["OWNER"] },
      orgA,
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ROLE_ASSIGN_FORBIDDEN");
  });

  it("prevents demoting the last owner", async () => {
    const res = await adminAClient.patch(
      `/v1/organizations/current/members/${ownerAMembershipId}`,
      { roles: ["VIEWER"] },
      orgA,
    );
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_OWNER");
  });

  it("rejects unknown roles", async () => {
    const res = await ownerAClient.post(
      "/v1/organizations/current/members",
      { email: adminEmail, roles: ["SUPERUSER"] },
      orgA,
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_ROLE");
  });

  it("revoked membership loses all organization access", async () => {
    const revoke = await ownerAClient.patch(
      `/v1/organizations/current/members/${analystAMembershipId}`,
      { status: "REVOKED" },
      orgA,
    );
    expect(revoke.status).toBe(200);

    const read = await analystAClient.get("/v1/organizations/current/members", orgA);
    expect(read.status).toBe(404);
    expect(read.body.code).toBe("ORG_NOT_FOUND");

    const current = await analystAClient.get("/v1/organizations/current", orgA);
    expect(current.status).toBe(404);
  });

  it("reactivates a revoked membership", async () => {
    const reactivate = await ownerAClient.patch(
      `/v1/organizations/current/members/${analystAMembershipId}`,
      { status: "ACTIVE", roles: ["SECURITY_ANALYST"] },
      orgA,
    );
    expect(reactivate.status).toBe(200);

    const read = await analystAClient.get("/v1/organizations/current/members", orgA);
    expect(read.status).toBe(200);
  });

  it("cannot update a membership id from another organization", async () => {
    const bMembers = await ownerBClient.get("/v1/organizations/current/members", orgB);
    const bMembershipId = bMembers.body.members[0].membershipId as string;

    const res = await ownerAClient.patch(
      `/v1/organizations/current/members/${bMembershipId}`,
      { status: "REVOKED" },
      orgA,
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("MEMBER_NOT_FOUND");

    const stillActive = await ownerBClient.get("/v1/organizations/current/members", orgB);
    expect(stillActive.status).toBe(200);
    expect(
      stillActive.body.members.find(
        (m: { membershipId: string }) => m.membershipId === bMembershipId,
      ),
    ).toBeTruthy();
  });

  it("blocks cross-tenant organization context (client-supplied org id is verified)", async () => {
    const res = await ownerBClient.get("/v1/organizations/current", orgA);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ORG_NOT_FOUND");

    const members = await ownerBClient.get("/v1/organizations/current/members", orgA);
    expect(members.status).toBe(404);
  });

  it("rejects client-supplied organization ids in request bodies", async () => {
    const res = await ownerAClient.post(
      "/v1/organizations/current/members",
      {
        email: `stranger-${Date.now()}@socc.test`,
        roles: ["VIEWER"],
        organizationId: orgB,
        rolesBypass: ["OWNER"],
      },
      orgA,
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("denies access for a user whose only membership was revoked", async () => {
    const loneClient = new ApiClient(server);
    const lone = await registerUser(loneClient, "lone");
    userIds.push(lone.userId);
    orgIds.push(lone.organizationId);
    loneClient.clearCookie();
    const login = await loneClient.post("/v1/auth/login", {
      email: lone.email,
      password: "SyntheticTestPw!2026",
    });
    expect(login.status).toBe(200);
    loneClient.setCookieFrom(login.headers["set-cookie"]);

    const membership = await owner.organizationMembership.update({
      where: {
        organizationId_userId: {
          organizationId: lone.organizationId,
          userId: lone.userId,
        },
      },
      data: { status: "REVOKED" },
    });

    const res = await loneClient.get(
      "/v1/organizations/current",
      membership.organizationId,
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ORG_NOT_FOUND");

    const list = await loneClient.get("/v1/organizations");
    expect(list.status).toBe(200);
    const activeOrgs = (
      list.body.organizations as Array<{ membershipStatus: string }>
    ).filter((o) => o.membershipStatus === "ACTIVE");
    expect(activeOrgs).toHaveLength(0);
  });

  it("membership creation is transactional (invalid role leaves no partial membership)", async () => {
    const targetClient = new ApiClient(server);
    const target = await registerUser(targetClient, "txn");
    userIds.push(target.userId);
    orgIds.push(target.organizationId);

    const res = await ownerAClient.post(
      "/v1/organizations/current/members",
      { email: target.email, roles: ["VIEWER", "NOT_A_ROLE"] },
      orgA,
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("UNKNOWN_ROLE");

    const membership = await owner.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: orgA, userId: target.userId } },
    });
    expect(membership).toBeNull();

    const members = await ownerAClient.get("/v1/organizations/current/members", orgA);
    expect(
      (members.body.members as Array<{ email: string }>).find(
        (m) => m.email === target.email,
      ),
    ).toBeUndefined();
  });
});
