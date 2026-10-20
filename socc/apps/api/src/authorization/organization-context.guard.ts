import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import type { SoccRequest } from "../common/http.types.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { ORG_CONTEXT_KEY, type OrganizationContext } from "./auth.decorators.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the trusted organization context for organization-scoped routes.
 *
 * The client supplies `X-Organization-Id`; it is NEVER trusted as
 * authorization evidence. The guard verifies, server-side, that the
 * authenticated user has an ACTIVE membership in that organization and that
 * the organization itself is active. Failed membership checks return 404
 * (resource concealment, per the API contract) so callers cannot probe for
 * other tenants' organization IDs.
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(ORG_CONTEXT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<SoccRequest>();
    const authUser = request.authUser;
    if (!authUser) {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_REQUIRED,
        "Authentication is required.",
      );
    }

    const header = request.headers["x-organization-id"];
    const organizationId = typeof header === "string" ? header.trim() : "";
    if (!UUID_RE.test(organizationId)) {
      throw new ApiError(
        HttpStatus.BAD_REQUEST,
        ErrorCodes.VALIDATION_ERROR,
        "A valid X-Organization-Id header is required.",
      );
    }

    const membership = await this.prisma.runWithTenant(
      { userId: authUser.userId, organizationId },
      (tx) =>
        tx.organizationMembership.findFirst({
          where: {
            organizationId,
            userId: authUser.userId,
            status: "ACTIVE",
          },
          include: {
            roles: {
              include: {
                role: {
                  include: {
                    rolePermissions: { include: { permission: true } },
                  },
                },
              },
            },
          },
        }),
    );

    if (!membership) {
      throw new ApiError(
        HttpStatus.NOT_FOUND,
        ErrorCodes.ORG_NOT_FOUND,
        "Organization not found.",
      );
    }

    const [organization, user] = await Promise.all([
      this.prisma.organization.findUnique({ where: { id: organizationId } }),
      this.prisma.user.findUnique({ where: { id: authUser.userId } }),
    ]);

    if (!organization || organization.status !== "ACTIVE") {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ErrorCodes.ORG_SUSPENDED,
        "Organization is not active.",
      );
    }
    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_INVALID_SESSION,
        "Session is invalid or has expired.",
      );
    }

    const roleNames = membership.roles.map((r) => r.role.name);
    const permissions = new Set(
      membership.roles.flatMap((r) =>
        r.role.rolePermissions.map((rp) => rp.permission.code),
      ),
    );

    const orgContext: OrganizationContext = {
      userId: authUser.userId,
      sessionId: authUser.sessionId,
      organizationId,
      membershipId: membership.id,
      roleNames,
      permissions,
    };
    request.orgContext = orgContext;
    return true;
  }
}
