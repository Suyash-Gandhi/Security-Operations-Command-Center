import { HttpStatus, Injectable } from "@nestjs/common";
import { ApiError, ErrorCodes } from "./api-error.js";

interface AttemptRecord {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-memory throttle for sensitive endpoints (login).
 *
 * Limitations (documented): per-process state only; not shared across
 * replicas. A shared store (Redis) is the documented upgrade path once the
 * event pipeline introduces Redis in Phase 2.
 */
@Injectable()
export class LoginThrottleService {
  private readonly attempts = new Map<string, AttemptRecord>();
  private readonly limit = 10;
  private readonly windowMs = 15 * 60 * 1000;

  check(key: string): void {
    this.prune();
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || record.resetAt <= now) {
      return;
    }
    if (record.count >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      throw new ApiError(
        HttpStatus.TOO_MANY_REQUESTS,
        ErrorCodes.AUTH_RATE_LIMITED,
        `Too many attempts. Try again in ${retryAfterSeconds} seconds.`,
        { retryAfterSeconds },
      );
    }
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const record = this.attempts.get(key);
    if (!record || record.resetAt <= now) {
      this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
      return;
    }
    record.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts) {
      if (record.resetAt <= now) {
        this.attempts.delete(key);
      }
    }
  }
}
