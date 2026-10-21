import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
    message: "must be a valid email address",
  })
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string()
  .min(12, { message: "must be at least 12 characters" })
  .max(200, { message: "must be at most 200 characters" });

export const displayNameSchema = z.string().trim().min(1).max(100);

export const organizationNameSchema = z.string().trim().min(1).max(120);

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
    organizationName: organizationNameSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(200),
  })
  .strict();

export const createOrganizationSchema = z
  .object({
    name: organizationNameSchema,
  })
  .strict();

export const addMemberSchema = z
  .object({
    email: emailSchema,
    roles: z
      .array(z.string().trim().min(1).max(64))
      .min(1, { message: "at least one role is required" })
      .max(10),
  })
  .strict();

export const updateMemberSchema = z
  .object({
    status: z.enum(["ACTIVE", "REVOKED"]).optional(),
    roles: z
      .array(z.string().trim().min(1).max(64))
      .min(1, { message: "at least one role is required" })
      .max(10)
      .optional(),
  })
  .strict()
  .refine((v) => v.status !== undefined || v.roles !== undefined, {
    message: "at least one of status or roles must be provided",
  });

export const listMembersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
  })
  .strip();

export const uuidParamSchema = z.string().uuid();

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/, {
    message: "must contain visible ASCII characters only",
  });

const timestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be an ISO-8601 timestamp",
  })
  .transform((value) => new Date(value));

const assetFields = {
  name: z.string().trim().min(1).max(200),
  assetType: z.string().trim().min(1).max(64),
  hostname: z.string().trim().min(1).max(255).optional(),
  environment: z.string().trim().min(1).max(64).optional(),
  criticality: z.string().trim().min(1).max(32).optional(),
  owner: z.string().trim().min(1).max(200).optional(),
  lastSeenAt: timestampSchema.optional(),
};

export const createAssetSchema = z.object(assetFields).strict();

export const updateAssetSchema = z
  .object({
    ...assetFields,
    name: assetFields.name.optional(),
    assetType: assetFields.assetType.optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });

export const listAssetsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
    assetType: z.string().trim().min(1).max(64).optional(),
    search: z.string().trim().min(1).max(200).optional(),
  })
  .strip();

export const createEventSourceSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    sourceType: z.string().trim().min(1).max(64),
  })
  .strict();

export const updateEventSourceStatusSchema = z
  .object({
    status: z.enum(["ACTIVE", "DISABLED"]),
  })
  .strict();

export const listEventSourcesQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional(),
    status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  })
  .strip();

export const listEventsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
    eventType: z.string().trim().min(1).max(128).optional(),
    sourceId: z.string().uuid().optional(),
    assetId: z.string().uuid().optional(),
    severity: z.string().trim().min(1).max(32).optional(),
    from: timestampSchema.optional(),
    to: timestampSchema.optional(),
  })
  .strip()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must be before or equal to to",
    path: ["from"],
  });
