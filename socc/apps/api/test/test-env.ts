import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Loads the SOCC development/test environment file (apps/api/.env) into
 * process.env without overwriting variables that are already set, then
 * applies safe test defaults for variables that are optional.
 */
export function loadTestEnv(): void {
  const envPath = resolve(process.cwd(), ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
  process.env.NODE_ENV ??= "test";
  process.env.LOG_LEVEL ??= "error";
  process.env.SESSION_TTL_HOURS ??= "8";
  process.env.COOKIE_SECURE ??= "false";
  process.env.ALLOWED_ORIGINS ??= "http://localhost:3001";
}
