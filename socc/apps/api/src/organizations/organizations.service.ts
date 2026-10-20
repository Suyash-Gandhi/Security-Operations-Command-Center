import { HttpStatus, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Organization, OrganizationMembership } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import {
  OWNER_ROLE_NAME,
  isRoleName,
  roleCanGrantOwner,
  roleGrantsOwnership,
} from "../authorization/permissions.js";
import type { OrganizationContext } from "../authorization/auth.decorators.js";

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an organization owned by the acting user. The OWNER role and
   * membership are created atomically with the organization.
   */
  async createOrganization(
    userId: string,
    name: string,
    requestId?: string,
  ): Promise<{ organization: Organization; membershipId: string }> {
    const organizationId = randomUUID();
    const membershipId = randomUUID();

    const organization = await this.prisma.runWithTenant(
      { userId, organizationId },
      async (tx) => {
        const ownerRole = await tx.role.findUniqueOrThrow({
          where: { name: OWNER_ROLE_NAME },
        });
        const organization = await tx.organization.create({
          data: { id: organizationId, name },
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
          action: "organization.created",
          resourceType: "organization",
          resourceId: organizationId,
          requestId: requestId ?? null,
        });
        return organization;
      },
    );

    return { organization, membershipId };
  }

  async listMyOrganizations(userId: string): Promise<
    Array<{
      organizationId: string;
      name: string;
      status: string;
      membershipId: string;
      membershipStatus: string;
      roles: string[];
    }>
  > {
    return this.prisma.runWithUser(userId, async (tx) => {
      const memberships = await tx.organizationMembership.findMany({
        where: { userId },
        include: {
          organization: true,
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      });
      return memberships.map((m) => ({
        organizationId: m.organizationId,
        name: m.organization.name,
        status: m.organization.status,
        membershipId: m.id,
        membershipStatus: m.status,
        roles: m.roles.map((r) => r.role.name).sort(),
      }));
    });
  }

  async getCurrentOrganization(ctx: OrganizationContext): Promise<{
    id: string;
    name: string;
    status: string;
    membership: { id: string; roles: string[] };
  }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: ctx.organizationId },
    });
    if (!organization) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        ErrorCodes.ORG_NOT_FOUND,
        "Organization not found.",
      );
    }
    return {
      id: organization.id,
      name: organization.name,
      status: organization.status,
      membership: { id: ctx.membershipId, roles: [...ctx.roleNames].sort() },
    };
  }

  async listMembers(
    ctx: OrganizationContext,
    options: { limit: number; cursor?: string },
  ): Promise<{
    members: Array<{
      membershipId: string;
      userId: string;
      email: string;
      displayName: string;
      status: string;
      roles: string[];
      joinedAt: string;
    }>;
    nextCursor: string | null;
  }> {
    return this.prisma.runWithTenant(ctx, async (tx) => {
      const rows = await tx.organizationMembership.findMany({
        where: { organizationId: ctx.organizationId },
        include: {
          user: true,
          roles: { include: { role: true } },
        },
        orderBy: { createdAt: "asc" },
        take: options.limit + 1,
        ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, options.limit);
      const nextCursor = rows.length > options.limit ? (page.at(-1)?.id ?? null) : null;
      return {
        members: page.map((m) => ({
          membershipId: m.id,
          userId: m.userId,
          email: m.user.normalizedEmail,
          displayName: m.user.displayName,
          status: m.status,
          roles: m.roles.map((r) => r.role.name).sort(),
          joinedAt: m.createdAt.toISOString(),
        })),
        nextCursor,
      };
    });
  }

  /**
   * Adds an existing user to the caller's organization. Assignment rules:
   * only OWNER may grant OWNER; role names must exist. Reactivates a
   * REVOKED/INVITED membership. All checks and writes run in one transaction
   * with trusted tenant context.
   */
  async addMember(
    ctx: OrganizationContext,
    input: { email: string; roles: string[] },
    requestId?: string,
  ): Promise<{ membershipId: string; roles: string[]; status: string }> {
    const target = await this.prisma.user.findUnique({
      where: { normalizedEmail: input.email },
    });
    if (!target) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        ErrorCodes.USER_NOT_FOUND,
        "No registered user with that email can be added.",
      );
    }

    const roleNames = this.validateRoleAssignment(ctx, input.roles);
    const membershipId = randomUUID();

    return this.prisma.runWithTenant(ctx, async (tx) => {
      const existing = await tx.organizationMembership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: ctx.organizationId,
            userId: target.id,
          },
        },
      });
      if (existing && existing.status === "ACTIVE") {
        throw new ApiError(
          HttpStatus.CONFLICT,
          ErrorCodes.MEMBER_EXISTS,
          "This user is already an active member of the organization.",
        );
      }

      const roles = await tx.role.findMany({
        where: { name: { in: roleNames } },
      });

      let membership: OrganizationMembership;
      if (existing) {
        membership = await tx.organizationMembership.update({
          where: { id: existing.id },
          data: {
            status: "ACTIVE",
            roles: {
              deleteMany: {},
              create: roles.map((r) => ({ roleId: r.id })),
            },
          },
        });
      } else {
        membership = await tx.organizationMembership.create({
          data: {
            id: membershipId,
            organizationId: ctx.organizationId,
            userId: target.id,
            status: "ACTIVE",
            roles: { create: roles.map((r) => ({ roleId: r.id })) },
          },
        });
      }

      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "member.added",
        resourceType: "organization_membership",
        resourceId: membership.id,
        metadata: { roles: roleNames, targetUserId: target.id },
        requestId: requestId ?? null,
      });

      return {
        membershipId: membership.id,
        roles: roleNames,
        status: membership.status,
      };
    });
  }

  /**
   * Updates membership status and/or roles within a single organization
   * transaction. Cross-organization membership IDs are not visible (404).
   * Invariants: OWNER required to grant OWNER; the last active OWNER cannot
   * be demoted or revoked.
   */
  async updateMember(
    ctx: OrganizationContext,
    membershipId: string,
    input: { status?: "ACTIVE" | "REVOKED"; roles?: string[] },
    requestId?: string,
  ): Promise<{ membershipId: string; status: string; roles: string[] }> {
    const roleNames =
      input.roles !== undefined
        ? this.validateRoleAssignment(ctx, input.roles)
        : undefined;

    return this.prisma.runWithTenant(ctx, async (tx) => {
      const membership = await tx.organizationMembership.findFirst({
        where: { id: membershipId, organizationId: ctx.organizationId },
        include: { roles: { include: { role: true } } },
      });
      if (!membership) {
        throw new ApiError(
          HttpStatus.NOT_FOUND,
          ErrorCodes.MEMBER_NOT_FOUND,
          "Membership not found.",
        );
      }

      const currentRoleNames = membership.roles.map((r) => r.role.name);
      const keepsOwner =
        roleNames !== undefined
          ? roleGrantsOwnership(roleNames)
          : roleGrantsOwnership(currentRoleNames);
      const staysActive = input.status !== undefined ? input.status === "ACTIVE" : true;
      const wouldRemainOwner = keepsOwner && staysActive;

      if (!wouldRemainOwner) {
        const ownerCount = await tx.role.findUniqueOrThrow({
          where: { name: OWNER_ROLE_NAME },
          include: {
            membershipRoles: {
              where: {
                membership: { status: "ACTIVE", organizationId: ctx.organizationId },
              },
            },
          },
        });
        const isCurrentOwner = roleGrantsOwnership(currentRoleNames);
        const onlyOwner = isCurrentOwner && ownerCount.membershipRoles.length <= 1;
        if (onlyOwner) {
          throw new ApiError(
            HttpStatus.CONFLICT,
            ErrorCodes.LAST_OWNER,
            "The last active owner cannot be demoted or revoked.",
          );
        }
      }

      const updated = await tx.organizationMembership.update({
        where: { id: membership.id },
        data: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(roleNames !== undefined
            ? {
                roles: {
                  deleteMany: {},
                  create: (
                    await tx.role.findMany({ where: { name: { in: roleNames } } })
                  ).map((r) => ({ roleId: r.id })),
                },
              }
            : {}),
        },
        include: { roles: { include: { role: true } } },
      });

      await this.audit.recordInTx(tx, {
        organizationId: ctx.organizationId,
        actorId: ctx.userId,
        action: "member.updated",
        resourceType: "organization_membership",
        resourceId: membership.id,
        metadata: {
          ...(input.status !== undefined ? { status: input.status } : {}),
          ...(roleNames !== undefined ? { roles: roleNames } : {}),
          targetUserId: membership.userId,
        },
        requestId: requestId ?? null,
      });

      return {
        membershipId: updated.id,
        status: updated.status,
        roles: updated.roles.map((r) => r.role.name).sort(),
      };
    });
  }

  /**
   * Shared role-assignment rules. Rejects unknown roles and prevents
   * privilege escalation: only members holding a role that grants ownership
   * (i.e. OWNER) may assign the OWNER role.
   */
  private validateRoleAssignment(
    ctx: OrganizationContext,
    requested: string[],
  ): string[] {
    const unique = [...new Set(requested)];
    const unknown = unique.filter((r) => !isRoleName(r));
    if (unknown.length > 0) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.UNKNOWN_ROLE,
        "One or more roles are not recognized.",
        { roles: unknown },
      );
    }
    if (roleGrantsOwnership(unique) && !roleCanGrantOwner(ctx.roleNames)) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ErrorCodes.ROLE_ASSIGN_FORBIDDEN,
        "Only an organization owner can grant the owner role.",
      );
    }
    return unique;
  }
}
