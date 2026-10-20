import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { AppEnv } from "./env.validation.js";

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get nodeEnv(): AppEnv["NODE_ENV"] {
    return this.config.get("NODE_ENV", { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === "production";
  }

  get isTest(): boolean {
    return this.nodeEnv === "test";
  }

  get port(): number {
    return this.config.get("PORT", { infer: true });
  }

  get logLevel(): AppEnv["LOG_LEVEL"] {
    return this.config.get("LOG_LEVEL", { infer: true });
  }

  get appDatabaseUrl(): string {
    return this.config.get("SOC_APP_DATABASE_URL", { infer: true });
  }

  get sessionTtlMs(): number {
    return this.config.get("SESSION_TTL_HOURS", { infer: true }) * 60 * 60 * 1000;
  }

  get cookieSecure(): boolean {
    return this.config.get("COOKIE_SECURE", { infer: true });
  }

  get allowedOrigins(): string[] {
    return this.config.get("ALLOWED_ORIGINS", { infer: true });
  }
}
