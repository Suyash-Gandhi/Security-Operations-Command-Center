/**
 * Permission catalog for Phase 1. Permissions are stored in the database and
 * assigned to roles there; these constants give the code a stable vocabulary.
 * Later phases extend this catalog rather than inventing role-name checks.
 */
export const Permissions = {
  ORG_READ: "org:read",
  ORG_UPDATE: "org:update",
  ORG_MEMBERS_READ: "org:members:read",
  ORG_MEMBERS_WRITE: "org:members:write",
  AUDIT_READ: "audit:read",
  ASSETS_READ: "assets:read",
  ASSETS_WRITE: "assets:write",
  EVENT_SOURCES_READ: "event_sources:read",
  EVENT_SOURCES_WRITE: "event_sources:write",
  EVENTS_READ: "events:read",
} as const;

export type PermissionCode = (typeof Permissions)[keyof typeof Permissions];

export const ALL_PERMISSIONS: PermissionCode[] = Object.values(Permissions);

/**
 * Role definitions used by the database seed (migrations + prisma/seed).
 * The OWNER role may grant ownership; other roles may not.
 */
export const ROLE_DEFINITIONS = [
  {
    name: "OWNER",
    description: "Organization owner: full control over the organization.",
    permissions: [...ALL_PERMISSIONS],
    canGrantOwner: true,
  },
  {
    name: "SECURITY_ADMIN",
    description: "Security administrator: manages members and security configuration.",
    permissions: [
      Permissions.ORG_READ,
      Permissions.ORG_MEMBERS_READ,
      Permissions.ORG_MEMBERS_WRITE,
      Permissions.AUDIT_READ,
      Permissions.ASSETS_READ,
      Permissions.ASSETS_WRITE,
      Permissions.EVENT_SOURCES_READ,
      Permissions.EVENT_SOURCES_WRITE,
      Permissions.EVENTS_READ,
    ],
    canGrantOwner: false,
  },
  {
    name: "SECURITY_ANALYST",
    description: "Security analyst: investigates alerts and incidents.",
    permissions: [
      Permissions.ORG_READ,
      Permissions.ORG_MEMBERS_READ,
      Permissions.AUDIT_READ,
      Permissions.ASSETS_READ,
      Permissions.EVENT_SOURCES_READ,
      Permissions.EVENTS_READ,
    ],
    canGrantOwner: false,
  },
  {
    name: "INCIDENT_LEAD",
    description: "Incident lead: coordinates assignment and escalation.",
    permissions: [
      Permissions.ORG_READ,
      Permissions.ORG_MEMBERS_READ,
      Permissions.AUDIT_READ,
      Permissions.ASSETS_READ,
      Permissions.EVENT_SOURCES_READ,
      Permissions.EVENTS_READ,
    ],
    canGrantOwner: false,
  },
  {
    name: "AUDITOR",
    description: "Auditor: reads permitted audit and investigation records.",
    permissions: [
      Permissions.ORG_READ,
      Permissions.ORG_MEMBERS_READ,
      Permissions.AUDIT_READ,
      Permissions.ASSETS_READ,
      Permissions.EVENT_SOURCES_READ,
      Permissions.EVENTS_READ,
    ],
    canGrantOwner: false,
  },
  {
    name: "VIEWER",
    description: "Viewer: reads explicitly permitted records.",
    permissions: [
      Permissions.ORG_READ,
      Permissions.ORG_MEMBERS_READ,
      Permissions.ASSETS_READ,
      Permissions.EVENTS_READ,
    ],
    canGrantOwner: false,
  },
] as const;

export type RoleName = (typeof ROLE_DEFINITIONS)[number]["name"];

export const OWNER_ROLE_NAME: RoleName = "OWNER";

export function isRoleName(value: string): value is RoleName {
  return ROLE_DEFINITIONS.some((r) => r.name === value);
}

export function roleGrantsOwnership(roleNames: readonly string[]): boolean {
  return roleNames.includes(OWNER_ROLE_NAME);
}

export function roleCanGrantOwner(roleNames: readonly string[]): boolean {
  return roleNames.some(
    (r) => ROLE_DEFINITIONS.find((d) => d.name === r)?.canGrantOwner === true,
  );
}
