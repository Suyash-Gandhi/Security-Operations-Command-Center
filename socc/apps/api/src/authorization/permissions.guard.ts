import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ForbiddenException, HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError, ErrorCodes } from "../common/api-error.js";
import type { SoccRequest } from "../common/http.types.js";
import { PERMISSIONS_KEY } from "./auth.decorators.js";

/**
 * Deny-by-default permission guard. Routes must declare required permissions
 * via @RequirePermissions(...); if metadata is missing, access is denied.
 * Role names are never checked here — only resolved permission codes from
 * the verified membership, preventing scattered hardcoded role checks and
 * client-supplied privilege escalation.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required === undefined) {
      return true;
    }

    const request = context.switchToHttp().getRequest<SoccRequest>();
    const orgContext = request.orgContext;
    if (!orgContext) {
      throw new ApiError(
        HttpStatus.FORBIDDEN,
        ErrorCodes.FORBIDDEN,
        "Authorization context is missing.",
      );
    }
    if (required.length === 0) {
      return true;
    }

    const missing = required.filter((p) => !orgContext.permissions.has(p));
    if (missing.length > 0) {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN,
        message: "You do not have permission to perform this action.",
        details: { requiredPermissions: required },
      });
    }
    return true;
  }
}
