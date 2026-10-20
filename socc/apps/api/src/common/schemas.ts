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
