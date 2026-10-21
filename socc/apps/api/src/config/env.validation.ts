import { z } from "zod";

const postgresUrl = z.string().refine((v) => /^postgres(ql)?:\/\//.test(v), {
  message: "must be a postgresql:// or postgres:// URL",
});

const redisUrl = z.string().refine((v) => /^rediss?:\/\//.test(v), {
  message: "must be a redis:// or rediss:// URL",
});

const boolFromEnv = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");

/**
 * Environment schema for the SOCC API.
 *
 * Error messages intentionally name the variable but NEVER echo its value,
 * so secrets cannot leak through startup failures or logs.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    SOC_APP_DATABASE_URL: postgresUrl,
    SOC_REDIS_URL: redisUrl.default("redis://localhost:6380"),
    SOC_REDIS_STREAM: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .default("socc.events.v1"),
    SOC_REDIS_CONSUMER_GROUP: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9._:-]{1,128}$/)
      .default("socc-event-processors"),
    SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(8),
    COOKIE_SECURE: boolFromEnv,
    ALLOWED_ORIGINS: z
      .string()
      .default("http://localhost:3001")
      .transform((v) =>
        v
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0),
      )
      .refine(
        (origins) =>
          origins.every((o) => {
            try {
              const u = new URL(o);
              return u.protocol === "http:" || u.protocol === "https:";
            } catch {
              return false;
            }
          }),
        { message: "must be a comma-separated list of http(s):// origins" },
      ),
  })
  .strip();

export type AppEnv = z.infer<typeof envSchema>;

/**
 * Validate raw environment values. Throws an Error whose message names
 * invalid or missing variables without disclosing their values.
 */
export function validateEnv(raw: NodeJS.ProcessEnv): AppEnv {
  const candidate: Record<string, unknown> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const value = raw[key];
    if (value !== undefined && value !== "") {
      candidate[key] = value;
    }
  }
  const result = envSchema.safeParse(candidate);
  if (!result.success) {
    const names = [
      ...new Set(result.error.issues.map((i) => String(i.path[0] ?? "environment"))),
    ].sort();
    throw new Error(
      `Invalid or missing environment configuration. Check: ${names.join(", ")}. ` +
        `See .env.example for the expected variables (values are never echoed).`,
    );
  }
  return result.data;
}
