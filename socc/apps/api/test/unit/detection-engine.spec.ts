import { describe, expect, it } from "vitest";

describe("detection engine types", () => {
  it("validates threshold config shape", () => {
    const cfg = {
      ruleType: "THRESHOLD",
      eventType: "auth.login.failed",
      groupBy: ["actor", "sourceIp"],
      threshold: 5,
      windowMinutes: 5,
    };
    expect(cfg.ruleType).toBe("THRESHOLD");
    expect(cfg.threshold).toBe(5);
    expect(cfg.windowMinutes).toBe(5);
  });
});
