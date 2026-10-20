import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Session, Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service.js";
import { AppConfigService } from "../config/app-config.service.js";

export const SESSION_COOKIE_NAME = "socc_session";

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Opaque, server-side sessions. Only the SHA-256 hash of the token is stored;
 * the raw token exists solely in the client's HttpOnly cookie. Sessions can
 * be revoked (logout) and expire on a configurable TTL.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Creates a session. Pass the surrounding transaction client when the user
   * row was created in the same transaction, so the foreign key is checked
   * against the transaction's own uncommitted rows.
   */
  async create(
    userId: string,
    userAgent?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ token: string; session: Session }> {
    const token = randomBytes(32).toString("base64url");
    const session = await (tx ?? this.prisma).session.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + this.config.sessionTtlMs),
        userAgent: userAgent ? userAgent.slice(0, 256) : null,
      },
    });
    return { token, session };
  }

  /**
   * Validates a raw token: returns the session only when it exists, is
   * active, and has not expired. Expired or revoked sessions are invalid.
   */
  async validate(token: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
    });
    if (!session) return null;
    if (session.status !== "ACTIVE") return null;
    if (session.revokedAt !== null) return null;
    if (session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
  }
}
