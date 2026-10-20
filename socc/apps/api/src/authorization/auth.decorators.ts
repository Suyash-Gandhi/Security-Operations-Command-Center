import { SetMetadata, createParamDecorator } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";

export const IS_PUBLIC_KEY = "socc.isPublic";
export const PERMISSIONS_KEY = "socc.permissions";
export const ORG_CONTEXT_KEY = "socc.organizationContext";

/** Marks a route as accessible without an authenticated session. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires the listed permission codes on the resolved organization context. */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Marks a route as requiring a verified organization context. */
export const UseOrganizationContext = () => SetMetadata(ORG_CONTEXT_KEY, true);

export interface AuthUser {
  userId: string;
  sessionId: string;
}

export interface OrganizationContext {
  userId: string;
  sessionId: string;
  organizationId: string;
  membershipId: string;
  roleNames: string[];
  permissions: Set<string>;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest<{ authUser: AuthUser }>();
    return request.authUser;
  },
);

export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationContext => {
    const request = ctx.switchToHttp().getRequest<{ orgContext: OrganizationContext }>();
    return request.orgContext;
  },
);
