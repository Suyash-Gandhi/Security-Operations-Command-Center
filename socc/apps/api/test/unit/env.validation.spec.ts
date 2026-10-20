import { describe, expect, it } from "vitest";
import { validateEnv } from "../../src/config/env.validation.js";

const VALID_URL = "postgresql://socc_app:password@localhost:5433/socc";

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return { SOC_APP_DATABASE_URL: VALID_URL, ...overrides };
}

describe("validateEnv", () => {
  it("accepts a valid configuration and coerces types", () => {
    const parsed = validateEnv(
      env({
        NODE_ENV: "test",
        PORT: "4000",
        LOG_LEVEL: "warn",
        SESSION_TTL_HOURS: "12",
        COOKIE_SECURE: "true",
        ALLOWED_ORIGINS: "http://localhost:3001,https://socc.example",
      }),
    );
    expect(parsed.PORT).toBe(4000);
    expect(parsed.SESSION_TTL_HOURS).toBe(12);
    expect(parsed.COOKIE_SECURE).toBe(true);
    expect(parsed.ALLOWED_ORIGINS).toEqual([
      "http://localhost:3001",
      "https://socc.example",
    ]);
  });

  it("applies documented defaults for optional values", () => {
    const parsed = validateEnv(env({}));
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.PORT).toBe(3000);
    expect(parsed.COOKIE_SECURE).toBe(false);
    expect(parsed.LOG_LEVEL).toBe("info");
  });

  it("rejects a missing required database URL and names the variable", () => {
    expect(() => validateEnv({})).toThrow(/SOC_APP_DATABASE_URL/);
  });

  it("rejects a non-postgres database URL", () => {
    expect(() =>
      validateEnv(env({ SOC_APP_DATABASE_URL: "mysql://localhost/socc" })),
    ).toThrow(/SOC_APP_DATABASE_URL/);
  });

  it("rejects an invalid port and names the variable", () => {
    expect(() => validateEnv(env({ PORT: "not-a-port" }))).toThrow(/PORT/);
    expect(() => validateEnv(env({ PORT: "70000" }))).toThrow(/PORT/);
  });

  it("rejects invalid boolean and log level values", () => {
    expect(() => validateEnv(env({ COOKIE_SECURE: "yes" }))).toThrow(/COOKIE_SECURE/);
    expect(() => validateEnv(env({ LOG_LEVEL: "loud" }))).toThrow(/LOG_LEVEL/);
  });

  it("rejects malformed allowed origins", () => {
    expect(() => validateEnv(env({ ALLOWED_ORIGINS: "not a url" }))).toThrow(
      /ALLOWED_ORIGINS/,
    );
  });

  it("never echoes secret values in error messages", () => {
    const secret = "postgres://user:TOPSECRETVALUE@localhost:5433/socc";
    let message = "";
    try {
      validateEnv({ SOC_APP_DATABASE_URL: secret, PORT: "invalid" });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("PORT");
    expect(message).not.toContain("TOPSECRETVALUE");
    expect(message).not.toContain(secret);
  });
});
