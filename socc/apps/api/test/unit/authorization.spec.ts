import { describe, expect, it } from "vitest";
import {
  ALL_PERMISSIONS,
  OWNER_ROLE_NAME,
  Permissions,
  ROLE_DEFINITIONS,
  isRoleName,
  roleCanGrantOwner,
  roleGrantsOwnership,
} from "../../src/authorization/permissions.js";
import { LoginThrottleService } from "../../src/common/login-throttle.service.js";

describe("role and permission model", () => {
  it("defines the documented product roles", () => {
    const names = ROLE_DEFINITIONS.map((r) => r.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "OWNER",
        "SECURITY_ADMIN",
        "SECURITY_ANALYST",
        "INCIDENT_LEAD",
        "AUDITOR",
        "VIEWER",
      ]),
    );
  });

  it("grants organization settings changes only to OWNER", () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.name === OWNER_ROLE_NAME) {
        expect(
          ALL_PERMISSIONS.every((p) =>
            (role.permissions as readonly string[]).includes(p),
          ),
        ).toBe(true);
        expect(role.canGrantOwner).toBe(true);
      } else {
        expect(role.permissions as readonly string[]).not.toContain(
          Permissions.ORG_UPDATE,
        );
        expect(role.canGrantOwner).toBe(false);
      }
    }
  });

  it("management roles can write members while read-only roles cannot", () => {
    const canWrite = ROLE_DEFINITIONS.filter((r) =>
      (r.permissions as readonly string[]).includes(Permissions.ORG_MEMBERS_WRITE),
    ).map((r) => r.name);
    expect(canWrite.sort()).toEqual(["OWNER", "SECURITY_ADMIN"]);

    const viewer = ROLE_DEFINITIONS.find((r) => r.name === "VIEWER")!;
    expect(viewer.permissions as readonly string[]).not.toContain(
      Permissions.ORG_MEMBERS_WRITE,
    );
    expect(viewer.permissions as readonly string[]).not.toContain(Permissions.AUDIT_READ);
  });

  it("only allows OWNER to grant ownership", () => {
    expect(roleCanGrantOwner(["OWNER"])).toBe(true);
    expect(roleCanGrantOwner(["SECURITY_ADMIN"])).toBe(false);
    expect(roleCanGrantOwner(["SECURITY_ANALYST"])).toBe(false);
    expect(roleCanGrantOwner(["VIEWER", "SECURITY_ADMIN"])).toBe(false);
  });

  it("detects ownership-granting role sets", () => {
    expect(roleGrantsOwnership(["OWNER"])).toBe(true);
    expect(roleGrantsOwnership(["SECURITY_ADMIN", "VIEWER"])).toBe(false);
  });

  it("validates role names", () => {
    expect(isRoleName("OWNER")).toBe(true);
    expect(isRoleName("SUPERUSER")).toBe(false);
  });
});

describe("LoginThrottleService", () => {
  it("allows attempts below the limit and blocks after it", () => {
    const throttle = new LoginThrottleService();
    const key = "ip:user@example.test";
    for (let i = 0; i < 10; i += 1) {
      throttle.check(key);
      throttle.recordFailure(key);
    }
    expect(() => throttle.check(key)).toThrow(/Too many attempts/);
  });

  it("resets after a successful attempt", () => {
    const throttle = new LoginThrottleService();
    const key = "ip2:user@example.test";
    for (let i = 0; i < 10; i += 1) {
      throttle.check(key);
      throttle.recordFailure(key);
    }
    throttle.reset(key);
    expect(() => throttle.check(key)).not.toThrow();
  });
});
