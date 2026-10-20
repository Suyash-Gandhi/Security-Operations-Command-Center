import type { Request } from "express";
import type { User } from "@prisma/client";
import type { AuthUser, OrganizationContext } from "../authorization/auth.decorators.js";

/**
 * Request type used across guards, middleware, and controllers. Keeps all
 * request-scoped augmentations in one place instead of global module
 * augmentation (which is fragile under strict pnpm layouts).
 */
export interface SoccRequest extends Request {
  requestId?: string;
  authUser?: AuthUser;
  authDbUser?: User;
  orgContext?: OrganizationContext;
}
