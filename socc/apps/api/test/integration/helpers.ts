import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import request from "supertest";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AppModule } from "../../src/app.module.js";
import { JsonLoggerService } from "../../src/logger/json-logger.service.js";
import { AllExceptionsFilter } from "../../src/common/all-exceptions.filter.js";

export interface TestApp {
  app: INestApplication;
  server: Server;
}

export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.use(cookieParser());
  app.setGlobalPrefix("v1", { exclude: ["health", "health/ready"] });
  app.useGlobalFilters(new AllExceptionsFilter(moduleRef.get(JsonLoggerService)));
  await app.init();
  return { app, server: app.getHttpServer() };
}

/** HTTP client that keeps a session cookie between requests. */
export class ApiClient {
  private cookie: string | undefined;

  constructor(private readonly server: Server) {}

  get(path: string, orgId?: string) {
    let req = request(this.server).get(path);
    if (this.cookie) req = req.set("Cookie", this.cookie);
    if (orgId) req = req.set("X-Organization-Id", orgId);
    return req;
  }

  post(path: string, body?: unknown, orgId?: string) {
    let req = request(this.server)
      .post(path)
      .send(body as object);
    if (this.cookie) req = req.set("Cookie", this.cookie);
    if (orgId) req = req.set("X-Organization-Id", orgId);
    return req;
  }

  patch(path: string, body?: unknown, orgId?: string) {
    let req = request(this.server)
      .patch(path)
      .send(body as object);
    if (this.cookie) req = req.set("Cookie", this.cookie);
    if (orgId) req = req.set("X-Organization-Id", orgId);
    return req;
  }

  setCookieFrom(setCookie: string[] | string | undefined): void {
    if (!setCookie) return;
    const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    if (first) {
      this.cookie = first.split(";")[0];
    }
  }

  clearCookie(): void {
    this.cookie = undefined;
  }

  getCookie(): string | undefined {
    return this.cookie;
  }
}

/** Prisma client as the least-privilege runtime role (RLS enforced). */
export function appRolePrisma(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: process.env.SOC_APP_DATABASE_URL,
  });
}

/** Prisma client as the migration/owner role (bypasses RLS; admin/test use). */
export function ownerPrisma(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
}

export function syntheticEmail(prefix: string): string {
  return `${prefix.toLowerCase()}-${randomUUID().slice(0, 8)}@socc.test`;
}

export const SYNTHETIC_PASSWORD = "SyntheticTestPw!2026";

export interface RegisterResult {
  userId: string;
  organizationId: string;
  email: string;
}

/** Registers a synthetic user and returns identity details. */
export async function registerUser(
  client: ApiClient,
  prefix: string,
): Promise<RegisterResult> {
  const email = syntheticEmail(prefix);
  const res = await client.post("/v1/auth/register", {
    email,
    password: SYNTHETIC_PASSWORD,
    displayName: `Synthetic ${prefix}`,
    organizationName: `Org ${prefix}-${email.split("@")[0]}`,
  });
  if (res.status !== 201) {
    throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  client.setCookieFrom(res.headers["set-cookie"]);
  return {
    userId: res.body.user.id as string,
    organizationId: res.body.organization.id as string,
    email,
  };
}

/** Removes synthetic users/orgs created by a test (owner role bypasses RLS). */
export async function cleanupSynthetic(
  prisma: PrismaClient,
  userIds: string[],
  organizationIds: string[],
): Promise<void> {
  if (organizationIds.length > 0) {
    await prisma.auditLog.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
  }
  if (userIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}
