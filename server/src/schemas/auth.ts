import { z } from 'zod';
import { emailSchema, latitudeSchema, longitudeSchema, orgTypeSchema, passwordSchema, roleSchema } from './common';

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(2, 'Name is too short').max(120),
  organizationName: z.string().trim().min(2, 'Organization name is too short').max(160),
  organizationType: orgTypeSchema,
  role: z.enum(['PROVIDER', 'RECIPIENT']),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(240).optional().or(z.literal('')),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  organizationName: z.string().trim().min(2).max(160).optional(),
  phone: z.string().trim().max(40).optional().or(z.literal('')),
  address: z.string().trim().max(240).optional().or(z.literal('')),
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
});

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  organizationId: z.string().nullable(),
  organizationName: z.string().nullable(),
  organizationStatus: z.string().nullable(),
  organizationType: z.string().nullable(),
  createdAt: z.string(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const authResponseSchema = z.object({
  user: publicUserSchema,
  csrfToken: z.string(),
  /** Human-readable explanation of what this account may do right now. */
  capabilities: z.object({
    canPublishListing: z.boolean(),
    canReserve: z.boolean(),
    canVerifyPickup: z.boolean(),
    canModerateOrganizations: z.boolean(),
    blockedReason: z.string().nullable(),
  }),
});
export type AuthResponse = z.infer<typeof authResponseSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});
