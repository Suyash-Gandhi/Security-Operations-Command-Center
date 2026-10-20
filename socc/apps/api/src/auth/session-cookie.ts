import type { Request, Response } from "express";
import type { AppConfigService } from "../config/app-config.service.js";
import { SESSION_COOKIE_NAME } from "./session.service.js";

export function setSessionCookie(
  res: Response,
  token: string,
  config: AppConfigService,
  maxAgeMs: number,
): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    maxAge: maxAgeMs,
  });
}

export function clearSessionCookie(res: Response, config: AppConfigService): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
  });
}

export function readSessionCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, unknown> | undefined;
  const value = cookies?.[SESSION_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
