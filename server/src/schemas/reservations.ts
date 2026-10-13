import { z } from 'zod';
import { isoDateString, reservationStatusSchema } from './common';

export const createReservationSchema = z.object({
  quantity: z.coerce.number().positive('Quantity must be greater than 0'),
  pickupStart: isoDateString.optional(),
  pickupEnd: isoDateString.optional(),
  note: z.string().trim().max(500).default(''),
});
export type CreateReservationInput = z.infer<typeof createReservationSchema>;

export const cancelReservationSchema = z.object({
  reason: z.string().trim().max(240).optional(),
});

export const verifyPickupSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit pickup code'),
  reservationId: z.string().min(1).optional(),
});

export interface ReservationView {
  id: string;
  listingId: string;
  listingTitle: string;
  listingUnit: string;
  listingCategory: string;
  listingStorage: string;
  status: string;
  quantity: number;
  unit: string;
  pickupStart: string;
  pickupEnd: string;
  windowEnd: string;
  createdAt: string;
  collectedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  cancelledBy: string | null;
  codeAttempts: number;
  locked: boolean;
  /** Plaintext code, only ever returned to the reservation owner (recipient side). */
  code: string | null;
  codeRevealed: boolean;
  provider: { id: string; name: string };
  recipient: { id: string; name: string };
  /** Exact pickup address — only visible to the provider and the reserving recipient. */
  pickupAddress: string | null;
  pickupInstructions: string | null;
}

export interface ReservationListResponse {
  reservations: ReservationView[];
  count: number;
}

export interface CreateReservationResponse {
  reservation: ReservationView;
  /** Shown once in the response; also retrievable from the recipient's reservations page. */
  pickupCode: string;
  listingStatus: string;
  quantityRemaining: number;
}

export const MEALS_ESTIMATE_NOTE =
  'Meals are estimated using the UN-style rule of thumb that one meal weighs about {factor} kg. ' +
  'Formula: meals = rescued kg / {factor}. This is an estimate, not a measured figure.';

export interface ImpactBreakdownRow {
  key: string;
  label: string;
  pickups: number;
  quantity: number;
  kg: number;
}

export interface ImpactStats {
  scope: 'platform' | 'provider' | 'recipient' | 'admin';
  totals: {
    pickups: number;
    /** Total quantity in the provider's own units. */
    quantity: number;
    /** Total kg of food rescued (only rows whose unit is 'kg' contribute exactly). */
    kg: number;
    unitFreeQuantity: number;
    listings: number;
    activeListings: number;
    reservedListings: number;
    pendingReservations: number;
  };
  meals: {
    estimate: number;
    kgPerMeal: number;
    formula: string;
    note: string;
  };
  monthly: Array<{ month: string; pickups: number; quantity: number; kg: number; meals: number }>;
  byStorage: ImpactBreakdownRow[];
  byCategory: ImpactBreakdownRow[];
  recentPickups: Array<{
    id: string;
    listingTitle: string;
    quantity: number;
    unit: string;
    collectedAt: string | null;
    providerName: string;
    recipientName: string;
  }>;
}

export { reservationStatusSchema };
