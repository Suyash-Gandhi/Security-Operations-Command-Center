import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import {
  ApiClient,
  SYNTHETIC_PASSWORD,
  appRolePrisma,
  cleanupSynthetic,
  createTestApp,
  ownerPrisma,
  registerUser,
} from "./helpers.js";
import type { PrismaClient } from "@prisma/client";

describe("health and authentication", () => {
  let app: INestApplication;
  let server: Server;
  let owner: PrismaClient;

  beforeAll(async () => {
    ({ app, server } = await createTestApp());
    owner = ownerPrisma();
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  it("GET /health returns liveness without secrets", async () => {
    const res = await new ApiClient(server).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "socc-api" });
    expect(JSON.stringify(res.body)).not.toMatch(/postgres|password|secret/i);
  });

  it("GET /health/ready verifies database connectivity", async () => {
    const res = await new ApiClient(server).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", database: "up" });
  });

  it("rejects unauthenticated access to protected endpoints", async () => {
    const client = new ApiClient(server);
    const me = await client.get("/v1/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("AUTH_REQUIRED");

    const orgs = await client.get("/v1/organizations");
    expect(orgs.status).toBe(401);
  });

  it("registers a user with a first organization and session cookie", async () => {
    const client = new ApiClient(server);
    const email = `reg-${randomUUID().slice(0, 8)}@socc.test`;
    const res = await client.post("/v1/auth/register", {
      email,
      password: SYNTHETIC_PASSWORD,
      displayName: "Synthetic Register",
      organizationName: "Synthetic Register Org",
    });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(email);
    expect(res.body.organization.id).toBeTruthy();

    const setCookie = res.headers["set-cookie"] as string[] | string | undefined;
    expect(JSON.stringify(setCookie)).toContain("socc_session");
    expect(JSON.stringify(setCookie).toLowerCase()).toContain("httponly");

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("argon2");
    expect(raw).not.toContain(SYNTHETIC_PASSWORD);

    client.setCookieFrom(setCookie);
    const me = await client.get("/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.memberships[0].roles).toEqual(["OWNER"]);

    await cleanupSynthetic(owner, [res.body.user.id], [res.body.organization.id]);
  });

  it("rejects duplicate registration with the same email", async () => {
    const client = new ApiClient(server);
    const email = `dup-${randomUUID().slice(0, 8)}@socc.test`;
    const body = {
      email,
      password: SYNTHETIC_PASSWORD,
      displayName: "Synthetic Dup",
      organizationName: "Synthetic Dup Org",
    };
    const first = await client.post("/v1/auth/register", body);
    expect(first.status).toBe(201);
    const second = await new ApiClient(server).post("/v1/auth/register", body);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe("EMAIL_TAKEN");
    await cleanupSynthetic(owner, [first.body.user.id], [first.body.organization.id]);
  });

  it("rejects weak passwords without echoing the value", async () => {
    const client = new ApiClient(server);
    const res = await client.post("/v1/auth/register", {
      email: `weak-${randomUUID().slice(0, 8)}@socc.test`,
      password: "short",
      displayName: "Weak",
      organizationName: "Weak Org",
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(res.body)).not.toContain("short");
  });

  it("rejects invalid credentials with a generic error", async () => {
    const client = new ApiClient(server);
    const identity = await registerUser(client, "badpw");
    client.clearCookie();

    const res = await client.post("/v1/auth/login", {
      email: identity.email,
      password: "definitely-wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_CREDENTIALS");
    expect(res.body.message).toBe("Invalid email or password.");

    const unknown = await client.post("/v1/auth/login", {
      email: `nobody-${randomUUID().slice(0, 8)}@socc.test`,
      password: "whatever-long-password",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe("AUTH_INVALID_CREDENTIALS");

    await cleanupSynthetic(owner, [identity.userId], [identity.organizationId]);
  });

  it("authenticates with valid credentials and revokes on logout", async () => {
    const seedClient = new ApiClient(server);
    const identity = await registerUser(seedClient, "login");
    seedClient.clearCookie();

    const login = await seedClient.post("/v1/auth/login", {
      email: identity.email,
      password: SYNTHETIC_PASSWORD,
    });
    expect(login.status).toBe(200);
    seedClient.setCookieFrom(login.headers["set-cookie"]);

    const me = await seedClient.get("/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe(identity.userId);

    const logout = await seedClient.post("/v1/auth/logout");
    expect(logout.status).toBe(204);

    const afterLogout = await seedClient.get("/v1/auth/me");
    expect(afterLogout.status).toBe(401);
    expect(afterLogout.body.code).toBe("AUTH_INVALID_SESSION");

    await cleanupSynthetic(owner, [identity.userId], [identity.organizationId]);
  });

  it("rejects expired sessions", async () => {
    const client = new ApiClient(server);
    const identity = await registerUser(client, "expiry");

    const session = await owner.session.findFirst({
      where: { userId: identity.userId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
    });
    expect(session).not.toBeNull();
    await owner.session.update({
      where: { id: session!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await client.get("/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_SESSION");

    await cleanupSynthetic(owner, [identity.userId], [identity.organizationId]);
  });

  it("rejects sessions of disabled users", async () => {
    const client = new ApiClient(server);
    const identity = await registerUser(client, "disabled");

    await owner.user.update({
      where: { id: identity.userId },
      data: { status: "DISABLED" },
    });

    const res = await client.get("/v1/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("AUTH_INVALID_SESSION");

    await owner.user.update({
      where: { id: identity.userId },
      data: { status: "ACTIVE" },
    });
    await cleanupSynthetic(owner, [identity.userId], [identity.organizationId]);
  });

  it("throttles repeated failed logins", async () => {
    const client = new ApiClient(server);
    const identity = await registerUser(client, "throttle");

    for (let i = 0; i < 10; i += 1) {
      const res = await client.post("/v1/auth/login", {
        email: identity.email,
        password: `wrong-password-${i}-pad`,
      });
      expect(res.status).toBe(401);
    }
    const blocked = await client.post("/v1/auth/login", {
      email: identity.email,
      password: SYNTHETIC_PASSWORD,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("AUTH_RATE_LIMITED");

    await cleanupSynthetic(owner, [identity.userId], [identity.organizationId]);
  });

  it("rejects state-changing requests from disallowed origins (CSRF)", async () => {
    const client = new ApiClient(server);
    const res = await client
      .post("/v1/auth/login", { email: "x@socc.test", password: "whatever-long" })
      .set("Origin", "https://evil.example");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_REJECTED");
  });
});

describe("app-role database connectivity", () => {
  it("the runtime application role can connect", async () => {
    const prisma = appRolePrisma();
    try {
      const rows = prisma.$queryRaw`SELECT 1 AS ok`;
      await expect(rows).resolves.toEqual([{ ok: 1 }]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
