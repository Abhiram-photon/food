import { z } from 'zod';
import { orgStatusSchema } from './common';

export const reviewOrganizationSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
  note: z.string().trim().max(500).default(''),
});
export type ReviewOrganizationInput = z.infer<typeof reviewOrganizationSchema>;

export const adminOrgQuerySchema = z.object({
  status: orgStatusSchema.optional(),
  role: z.enum(['PROVIDER', 'RECIPIENT', 'ADMIN']).optional(),
});

export interface AdminOrganizationView {
  id: string;
  name: string;
  type: string;
  role: string;
  status: string;
  contactEmail: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  userCount: number;
  listingCount: number;
  reservationCount: number;
}

export interface PlatformTotals {
  organizations: { total: number; pending: number; approved: number; rejected: number };
  listings: { total: number; active: number; reservedOut: number; expired: number; draft: number };
  reservations: { total: number; reserved: number; collected: number; cancelled: number };
  impact: { pickups: number; quantity: number; kg: number; mealsEstimate: number; kgPerMeal: number };
  monthly: Array<{ month: string; pickups: number; kg: number }>;
}
