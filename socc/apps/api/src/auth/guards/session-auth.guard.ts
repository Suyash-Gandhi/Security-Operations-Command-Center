import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ApiError, ErrorCodes } from "../../common/api-error.js";
import type { SoccRequest } from "../../common/http.types.js";
import { readSessionCookie } from "../session-cookie.js";
import { SessionService } from "../session.service.js";
import { IS_PUBLIC_KEY } from "../../authorization/auth.decorators.js";
import { PrismaService } from "../../prisma/prisma.service.js";

/**
 * Global session authentication guard.
 *
 * Validates the opaque session token from the HttpOnly cookie against the
 * server-side session store, enforcing status, revocation, and expiry, and
 * rejects sessions belonging to disabled users. Routes marked @Public() are
 * exempt; everything else fails closed with 401.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<SoccRequest>();

    const token = readSessionCookie(request);
    if (!token) {
      if (isPublic) return true;
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_REQUIRED,
        "Authentication is required.",
      );
    }

    const session = await this.sessions.validate(token);
    if (!session) {
      if (isPublic) return true;
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_INVALID_SESSION,
        "Session is invalid or has expired.",
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
    if (!user || user.status !== "ACTIVE") {
      if (isPublic) return true;
      throw new ApiError(
        HttpStatus.UNAUTHORIZED,
        ErrorCodes.AUTH_INVALID_SESSION,
        "Session is invalid or has expired.",
      );
    }

    request.authUser = { userId: session.userId, sessionId: session.id };
    request.authDbUser = user;
    return true;
  }
}
