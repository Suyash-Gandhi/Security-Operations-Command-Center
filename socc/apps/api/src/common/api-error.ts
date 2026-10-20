import type { HttpStatus } from "@nestjs/common";
import { HttpException } from "@nestjs/common";

/**
 * Application error with a stable machine-readable code and a safe,
 * user-facing message. Details must never contain secrets or raw payloads.
 */
export class ApiError extends HttpException {
  readonly code: string;

  constructor(status: HttpStatus, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
    this.code = code;
  }
}

export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  AUTH_INVALID_SESSION: "AUTH_INVALID_SESSION",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",
  FORBIDDEN: "FORBIDDEN",
  CSRF_REJECTED: "CSRF_REJECTED",
  ORG_NOT_FOUND: "ORG_NOT_FOUND",
  ORG_SUSPENDED: "ORG_SUSPENDED",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  EMAIL_TAKEN: "EMAIL_TAKEN",
  MEMBER_EXISTS: "MEMBER_EXISTS",
  MEMBER_NOT_FOUND: "MEMBER_NOT_FOUND",
  LAST_OWNER: "LAST_OWNER",
  ROLE_ASSIGN_FORBIDDEN: "ROLE_ASSIGN_FORBIDDEN",
  UNKNOWN_ROLE: "UNKNOWN_ROLE",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorEnvelope {
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}
