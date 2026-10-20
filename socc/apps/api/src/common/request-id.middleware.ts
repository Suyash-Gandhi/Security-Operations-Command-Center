import { randomUUID } from "node:crypto";
import type { NestMiddleware } from "@nestjs/common";
import { Injectable } from "@nestjs/common";
import type { NextFunction, Response } from "express";
import type { SoccRequest } from "./http.types.js";

/**
 * Assigns a request/correlation ID to every request, echoing it on the
 * response and making it available to filters and loggers.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: SoccRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers["x-request-id"];
    const requestId =
      typeof incoming === "string" && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : randomUUID();
    res.setHeader("x-request-id", requestId);
    req.requestId = requestId;
    next();
  }
}
