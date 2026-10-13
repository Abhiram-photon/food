/** Row shapes as stored in SQLite (snake_case, ISO-8601 timestamps). */

export interface OrganizationRow {
  id: string;
  name: string;
  type: string;
  role: string;
  status: string;
  contact_email: string;
  phone: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  organization_id: string | null;
  email: string;
  password_hash: string;
  display_name: string;
  role: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  csrf_token: string;
  expires_at: string;
  created_at: string;
}

export interface ListingRow {
  id: string;
  provider_id: string;
  created_by: string | null;
  title: string;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  allergens: string;
  storage: string;
  pickup_address: string;
  latitude: number;
  longitude: number;
  window_start: string;
  window_end: string;
  expires_at: string;
  pickup_instructions: string;
  status: string;
  quantity_remaining: number;
  created_at: string;
  updated_at: string;
}

export interface ReservationRow {
  id: string;
  listing_id: string;
  recipient_id: string;
  created_by: string | null;
  quantity: number;
  unit: string;
  pickup_start: string;
  pickup_end: string;
  status: string;
  code_hash: string;
  code_encrypted: string;
  code_attempts: number;
  locked_at: string | null;
  collected_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  entity_id: string | null;
  read_at: string | null;
  created_at: string;
}
