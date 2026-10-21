import { createHash, randomBytes } from "node:crypto";

/** SHA-256 hex digest used for opaque credential and request hashes. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Deterministic JSON serialization (sorted object keys) so request and event
 * fingerprints are stable across equivalent payloads.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${parts.join(",")}}`;
}

export interface SourceCredential {
  /** Returned to the caller exactly once; never stored or logged. */
  token: string;
  /** Only this digest is persisted. */
  hash: string;
}

export function createSourceCredential(): SourceCredential {
  const token = `socc_src_${randomBytes(32).toString("base64url")}`;
  return { token, hash: sha256Hex(token) };
}
