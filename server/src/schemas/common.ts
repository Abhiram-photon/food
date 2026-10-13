import { z } from 'zod';

/** Roles, statuses and enums shared by the API and the React client. */

export const ROLES = ['PROVIDER', 'RECIPIENT', 'ADMIN'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = (typeof ROLES)[number];

export const ORG_TYPES = [
  'BAKERY',
  'GROCERY',
  'CATERER',
  'HOUSEHOLD',
  'FOOD_BANK',
  'CHARITY',
  'SHELTER',
  'OTHER',
] as const;
export const orgTypeSchema = z.enum(ORG_TYPES);
export type OrgType = (typeof ORG_TYPES)[number];

/** Organization types that are shown as provider options, and as recipient options. */
export const PROVIDER_ORG_TYPES: OrgType[] = ['BAKERY', 'GROCERY', 'CATERER', 'HOUSEHOLD', 'OTHER'];
export const RECIPIENT_ORG_TYPES: OrgType[] = ['FOOD_BANK', 'CHARITY', 'SHELTER', 'OTHER'];

export const ORG_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const orgStatusSchema = z.enum(ORG_STATUSES);
export type OrgStatus = (typeof ORG_STATUSES)[number];

export const STORAGE_TYPES = ['AMBIENT', 'CHILLED', 'FROZEN', 'HOT'] as const;
export const storageSchema = z.enum(STORAGE_TYPES);
export type StorageType = (typeof STORAGE_TYPES)[number];

export const CATEGORIES = [
  'BAKERY',
  'PRODUCE',
  'PREPARED_MEALS',
  'DAIRY',
  'PANTRY',
  'BEVERAGES',
  'OTHER',
] as const;
export const categorySchema = z.enum(CATEGORIES);
export type Category = (typeof CATEGORIES)[number];

export const LISTING_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'RESERVED_OUT',
  'EXPIRED',
  'CANCELLED',
] as const;
export const listingStatusSchema = z.enum(LISTING_STATUSES);
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const RESERVATION_STATUSES = ['RESERVED', 'COLLECTED', 'CANCELLED', 'EXPIRED'] as const;
export const reservationStatusSchema = z.enum(RESERVATION_STATUSES);
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const NOTIFICATION_TYPES = [
  'RESERVATION_CREATED',
  'RESERVATION_CANCELLED',
  'PICKUP_VERIFIED',
  'ORG_APPROVED',
  'ORG_REJECTED',
  'LISTING_UPDATED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Units suggested in the UI. The API accepts free text. */
export const UNIT_SUGGESTIONS = ['kg', 'meals', 'boxes', 'loaves', 'litres', 'units'] as const;

export const isoDateString = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO-8601 date string');

export const idSchema = z.string().min(1).max(64);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), 'Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long');

export const latitudeSchema = z.number().min(-90).max(90);
export const longitudeSchema = z.number().min(-180).max(180);

/** Generic API error body. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const message = first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid input';
    const error = new Error(message);
    error.name = 'ZodValidationError';
    throw error;
  }
  return result.data;
}
