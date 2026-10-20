import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError, ErrorCodes } from "../../common/api-error.js";
import type { SoccRequest } from "../../common/http.types.js";
import { AppConfigService } from "../../config/app-config.service.js";

/**
 * CSRF defense for cookie-authenticated state-changing requests.
 *
 * - SameSite=Lax cookies already block cross-site form posts.
 * - When a browser sends an Origin header, it must match ALLOWED_ORIGINS.
 * - When Fetch Metadata is present, Sec-Fetch-Site must be same-origin/none.
 *
 * Requests without Origin/Sec-Fetch-Site (non-browser tooling with a valid
 * session cookie) pass; browsers always send these headers on cross-site
 * state-changing requests.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: AppConfigService) {
    this.allowed = new Set(config.allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<SoccRequest>();
    const method = request.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return true;
    }

    const origin = request.headers.origin;
    if (typeof origin === "string" && origin.length > 0 && origin !== "null") {
      if (!this.allowed.has(origin)) {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          ErrorCodes.CSRF_REJECTED,
          "Request origin is not allowed.",
        );
      }
    }

    const site = request.headers["sec-fetch-site"];
    if (typeof site === "string" && site.length > 0) {
      if (site !== "same-origin" && site !== "none") {
        throw new ApiError(
          HttpStatus.FORBIDDEN,
          ErrorCodes.CSRF_REJECTED,
          "Request site context is not allowed.",
        );
      }
    }

    return true;
  }
}
