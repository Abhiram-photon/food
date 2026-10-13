import { z } from 'zod';
import {
  CATEGORIES,
  STORAGE_TYPES,
  categorySchema,
  isoDateString,
  latitudeSchema,
  listingStatusSchema,
  longitudeSchema,
  storageSchema,
} from './common';

export const listingInputSchema = z.object({
  title: z.string().trim().min(3, 'Title is too short').max(140),
  description: z.string().trim().max(2000).default(''),
  category: categorySchema,
  quantity: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
  unit: z.string().trim().min(1, 'Unit is required').max(24),
  allergens: z
    .union([z.array(z.string().trim().min(1).max(40)), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined) return [] as string[];
      const parts = Array.isArray(value) ? value : value.split(',');
      return parts.map((p) => p.trim()).filter(Boolean).slice(0, 20);
    }),
  storage: storageSchema,
  pickupAddress: z.string().trim().min(4, 'Pickup address is required').max(240),
  latitude: latitudeSchema,
  longitude: longitudeSchema,
  windowStart: isoDateString,
  windowEnd: isoDateString,
  expiresAt: isoDateString.optional(),
  pickupInstructions: z.string().trim().max(2000).default(''),
});
export type ListingInput = z.infer<typeof listingInputSchema>;

/** Same as listingInput but without transform defaults, used for PATCH. */
export const listingPatchSchema = listingInputSchema.partial();

export const listingStatusActionSchema = z.object({
  action: z.enum(['PUBLISH', 'PAUSE', 'RESUME', 'CANCEL']),
  reason: z.string().trim().max(240).optional(),
});

export const searchQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  radius_km: z.coerce.number().positive().max(50).optional(),
  storage: storageSchema.optional(),
  category: categorySchema.optional(),
  q: z.string().trim().max(120).optional(),
  sort: z.enum(['nearest', 'ending_soon']).default('nearest'),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface PublicListing {
  id: string;
  title: string;
  description: string;
  category: string;
  quantity: number;
  quantityRemaining: number;
  unit: string;
  allergens: string[];
  storage: string;
  status: string;
  /** Rounded to 2 decimals (~1 km) — exact address is only shared with a reservation holder. */
  approximateLatitude: number;
  approximateLongitude: number;
  /** Present only when the viewer holds a reservation on this listing. */
  pickupAddress?: string | null;
  city?: string | null;
  windowStart: string;
  windowEnd: string;
  expiresAt: string;
  secondsLeft: number;
  distanceKm?: number | null;
  provider: {
    id: string;
    name: string;
    type: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface OwnerListing extends PublicListing {
  quantityReserved: number;
  pickupAddress: string;
  latitude: number;
  longitude: number;
  pickupInstructions: string;
  reservedCount: number;
  collectedCount: number;
}

export interface SearchResponse {
  listings: PublicListing[];
  count: number;
  center: { latitude: number; longitude: number } | null;
  radiusKm: number;
  sort: 'nearest' | 'ending_soon';
  availableStorage: string[];
  availableCategories: string[];
}

export interface ListingDetailResponse {
  listing: PublicListing;
  /** Server-computed reason the viewer cannot reserve, if any. */
  reservationBlockedReason: string | null;
  canReserve: boolean;
  isOwner: boolean;
  myReservation: {
    id: string;
    code: string | null;
    quantity: number;
    status: string;
    pickupStart: string;
    pickupEnd: string;
  } | null;
}

export const LISTING_SEARCH_STORAGE_OPTIONS = STORAGE_TYPES;
export const LISTING_SEARCH_CATEGORY_OPTIONS = CATEGORIES;
export { listingStatusSchema };
