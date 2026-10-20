import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Organization, User } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { PasswordService } from "./password.service.js";
import { SessionService } from "./session.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import { OWNER_ROLE_NAME } from "../authorization/permissions.js";

export interface AuthMeta {
  userAgent?: string;
  requestId?: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Registers a new user together with their first organization, granting the
   * OWNER role, and opens a session. All multi-record invariants are applied
   * in one database transaction with trusted tenant context.
   */
  async register(
    input: RegisterInput,
    meta: AuthMeta,
  ): Promise<{ user: User; organization: Organization; token: string }> {
    const existing = await this.prisma.user.findUnique({
      where: { normalizedEmail: input.email },
    });
    if (existing) {
      throw new ApiError(
        HttpStatus.CONFLICT,
        ErrorCodes.EMAIL_TAKEN,
        "An account with this email already exists.",
      );
    }

    const passwordHash = await this.passwords.hash(input.password);
    const userId = randomUUID();
    const organizationId = randomUUID();
    const membershipId = randomUUID();

    const { user, organization, token } = await this.prisma.runWithTenant(
      { userId, organizationId },
      async (tx) => {
        const ownerRole = await tx.role.findUniqueOrThrow({
          where: { name: OWNER_ROLE_NAME },
        });

        const user = await tx.user.create({
          data: {
            id: userId,
            normalizedEmail: input.email,
            displayName: input.displayName,
            passwordHash,
          },
        });
        const organization = await tx.organization.create({
          data: { id: organizationId, name: input.organizationName },
        });
        await tx.organizationMembership.create({
          data: {
            id: membershipId,
            organizationId,
            userId,
            status: "ACTIVE",
            roles: { create: [{ roleId: ownerRole.id }] },
          },
        });
        await this.audit.recordInTx(tx, {
          organizationId,
          actorId: userId,
          action: "auth.register",
          resourceType: "user",
          resourceId: userId,
          requestId: meta.requestId ?? null,
        });
        await this.audit.recordInTx(tx, {
          organizationId,
          actorId: userId,
          action: "organization.created",
          resourceType: "organization",
          resourceId: organizationId,
          requestId: meta.requestId ?? null,
        });
        await this.audit.recordInTx(tx, {
          organizationId,
          actorId: userId,
          action: "member.added",
          resourceType: "organization_membership",
          resourceId: membershipId,
          metadata: { roles: [OWNER_ROLE_NAME] },
          requestId: meta.requestId ?? null,
        });

        const { token } = await this.sessions.create(userId, meta.userAgent, tx);
        return { user, organization, token };
      },
    );

    return { user, organization, token };
  }

  /**
   * Verifies credentials. Returns null for any failure (unknown email, wrong
   * password, disabled account) so callers return one generic error and
   * cannot enumerate accounts.
   */
  async login(
    email: string,
    password: string,
    meta: AuthMeta,
  ): Promise<{ user: User; token: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: email },
    });
    if (!user) {
      await this.audit.record({
        organizationId: null,
        actorId: null,
        action: "auth.login_failed",
        resourceType: "user",
        metadata: { email },
        requestId: meta.requestId ?? null,
      });
      return null;
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid || user.status !== "ACTIVE") {
      await this.audit.record({
        organizationId: null,
        actorId: user.id,
        action: "auth.login_failed",
        resourceType: "user",
        resourceId: user.id,
        metadata: { email },
        requestId: meta.requestId ?? null,
      });
      return null;
    }

    const { token } = await this.sessions.create(user.id, meta.userAgent);
    await this.audit.record({
      organizationId: null,
      actorId: user.id,
      action: "auth.login",
      resourceType: "user",
      resourceId: user.id,
      requestId: meta.requestId ?? null,
    });
    return { user, token };
  }

  async logout(userId: string, sessionId: string, meta: AuthMeta): Promise<void> {
    await this.sessions.revoke(sessionId);
    await this.audit.record({
      organizationId: null,
      actorId: userId,
      action: "auth.logout",
      resourceType: "session",
      resourceId: sessionId,
      requestId: meta.requestId ?? null,
    });
  }

  async me(userId: string): Promise<{
    user: { id: string; email: string; displayName: string; status: string };
    memberships: Array<{
      organizationId: string;
      organizationName: string;
      organizationStatus: string;
      membershipId: string;
      membershipStatus: string;
      roles: string[];
    }>;
  }> {
    return this.prisma.runWithUser(userId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const memberships = await tx.organizationMembership.findMany({
        where: { userId },
        include: {
          organization: true,
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return {
        user: {
          id: user.id,
          email: user.normalizedEmail,
          displayName: user.displayName,
          status: user.status,
        },
        memberships: memberships.map((m) => ({
          organizationId: m.organizationId,
          organizationName: m.organization.name,
          organizationStatus: m.organization.status,
          membershipId: m.id,
          membershipStatus: m.status,
          roles: m.roles.map((r) => r.role.name).sort(),
        })),
      };
    });
  }

  throwInvalidCredentials(): never {
    throw new ApiError(
      HttpStatus.UNAUTHORIZED,
      ErrorCodes.AUTH_INVALID_CREDENTIALS,
      "Invalid email or password.",
    );
  }
}
