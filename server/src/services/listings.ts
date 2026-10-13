import type { AppConfig } from '../config';
import { Db } from '../db';
import type { ListingRow, OrganizationRow, ReservationRow } from '../db/types';
import { approximate, boundingBox, haversineKm } from '../lib/geo';
import { badRequest, conflict, notFound } from '../lib/errors';
import { isPast, nowIso, secondsUntil } from '../lib/time';
import { capabilitiesFor, type SessionUser } from './auth';
import type {
  ListingInput,
  OwnerListing,
  PublicListing,
  SearchQuery,
  SearchResponse,
} from '../schemas/listings';
import type { ListingStatus } from '../schemas/common';

/** Statuses that can still turn into EXPIRED once the clock passes expires_at. */
const EXPIRABLE_STATUSES: ListingStatus[] = ['ACTIVE', 'PAUSED', 'RESERVED_OUT'];
const TERMINAL_STATUSES: ListingStatus[] = ['EXPIRED', 'CANCELLED'];

export interface ListingContext {
  db: Db;
  config: AppConfig;
}

/** Effective status: statuses are computed on read so a stale row can never be shown as ACTIVE. */
export function computeListingStatus(row: ListingRow, now: Date = new Date()): ListingStatus {
  const status = row.status as ListingStatus;
  if (status === 'CANCELLED' || status === 'EXPIRED') return status;
  if (status === 'DRAFT') return status;
  if (EXPIRABLE_STATUSES.includes(status) && isPast(row.expires_at, now)) return 'EXPIRED';
  return status;
}

/** True when a provider may publish / keep the listing live. */
export function isPublishable(row: ListingRow, now: Date = new Date()): boolean {
  return !isPast(row.window_end, now);
}

/**
 * Persists clock-driven status changes. Called at the start of every API request
 * (cheap single UPDATE) and by a 60-second timer, so search never returns
 * listings that should already be EXPIRED.
 */
export function sweepStatuses(db: Db, now: Date = new Date()): number {
  const nowStr = now.toISOString();
  const result = db.run(
    `UPDATE listings SET status = 'EXPIRED', updated_at = ?
     WHERE status IN ('ACTIVE', 'PAUSED', 'RESERVED_OUT') AND expires_at <= ?`,
    [nowStr, nowStr],
  );
  db.run(
    `UPDATE reservations SET status = 'EXPIRED', updated_at = ?
     WHERE status = 'RESERVED' AND pickup_end <= ?`,
    [nowStr, nowStr],
  );
  return Number(result.changes ?? 0);
}

interface ProviderInfo {
  id: string;
  name: string;
  type: string;
}

function providerFor(db: Db, row: ListingRow): ProviderInfo {
  const org = db.get<OrganizationRow>('SELECT id, name, type FROM organizations WHERE id = ?', [
    row.provider_id,
  ]);
  return {
    id: org?.id ?? row.provider_id,
    name: org?.name ?? 'Unknown provider',
    type: org?.type ?? 'OTHER',
  };
}

export interface ListingViewOptions {
  /** When true, exact coordinates + address are included (owner or reservation holder). */
  revealExactLocation?: boolean;
  distanceKm?: number | null;
  now?: Date;
}

export function toPublicListing(
  db: Db,
  row: ListingRow,
  options: ListingViewOptions = {},
): PublicListing {
  const now = options.now ?? new Date();
  const provider = providerFor(db, row);
  const view: PublicListing = {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    quantity: row.quantity,
    quantityRemaining: row.quantity_remaining,
    unit: row.unit,
    allergens: row.allergens
      ? row.allergens
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
    storage: row.storage,
    status: computeListingStatus(row, now),
    approximateLatitude: approximate(row.latitude),
    approximateLongitude: approximate(row.longitude),
    windowStart: row.window_start,
    windowEnd: row.window_end,
    expiresAt: row.expires_at,
    secondsLeft: secondsUntil(row.expires_at, now),
    distanceKm: options.distanceKm ?? null,
    provider,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (options.revealExactLocation) {
    view.pickupAddress = row.pickup_address;
    view.pickupInstructions = row.pickup_instructions;
  }
  return view;
}

export function toOwnerListing(db: Db, row: ListingRow, now: Date = new Date()): OwnerListing {
  const base = toPublicListing(db, row, { revealExactLocation: true, now });
  const stats = db.get<{ reserved: number; reservedCount: number; collectedCount: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'RESERVED' THEN quantity ELSE 0 END), 0) AS reserved,
       COALESCE(SUM(CASE WHEN status = 'RESERVED' THEN 1 ELSE 0 END), 0) AS reservedCount,
       COALESCE(SUM(CASE WHEN status = 'COLLECTED' THEN 1 ELSE 0 END), 0) AS collectedCount
     FROM reservations WHERE listing_id = ?`,
    [row.id],
  );
  return {
    ...base,
    quantityReserved: Number(stats?.reserved ?? 0),
    reservedCount: Number(stats?.reservedCount ?? 0),
    collectedCount: Number(stats?.collectedCount ?? 0),
    pickupAddress: row.pickup_address,
    latitude: row.latitude,
    longitude: row.longitude,
    pickupInstructions: row.pickup_instructions,
  };
}

function validateWindow(input: { windowStart: string; windowEnd: string; expiresAt?: string }): {
  expiresAt: string;
} {
  const start = Date.parse(input.windowStart);
  const end = Date.parse(input.windowEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end))
    throw badRequest('Pickup window is invalid.');
  if (end <= start) throw badRequest('Pickup window end must be after the pickup window start.');
  const expiresAt = input.expiresAt ? Date.parse(input.expiresAt) : end;
  if (!Number.isFinite(expiresAt)) throw badRequest('expires_at is invalid.');
  if (expiresAt < start) throw badRequest('expires_at must not be before the pickup window start.');
  if (expiresAt > end) {
    throw badRequest(
      'expires_at cannot be later than the pickup window end — food should not stay listed after the pickup window closes.',
    );
  }
  return { expiresAt: new Date(expiresAt).toISOString() };
}

function normalizeAllergens(allergens: string[] | undefined): string {
  return (allergens ?? [])
    .map((a) => a.trim())
    .filter(Boolean)
    .join(', ');
}

export function createListing(
  ctx: ListingContext,
  actor: SessionUser,
  input: ListingInput,
): OwnerListing {
  const caps = capabilitiesFor(actor.user, actor.organization);
  if (caps.canPublishListing === false && actor.organization?.status !== 'APPROVED') {
    // A pending provider may still save a draft — that is the documented behaviour.
    if (actor.organization?.status === 'REJECTED') {
      throw conflict('Your organization application was rejected.', 'ORG_REJECTED');
    }
  }
  const organization = actor.organization;
  if (!organization) throw conflict('Your account is not linked to an organization.');
  if (actor.user.role !== 'PROVIDER') {
    throw conflict('Only provider organizations can create listings.', 'WRONG_ROLE');
  }
  const { expiresAt } = validateWindow(input);
  const id = crypto.randomUUID();
  const now = nowIso();
  const status: ListingStatus = input.quantity > 0 ? 'DRAFT' : 'DRAFT';

  return ctx.db.transaction(() => {
    ctx.db.run(
      `INSERT INTO listings
        (id, provider_id, created_by, title, description, category, quantity, unit, allergens, storage,
         pickup_address, latitude, longitude, window_start, window_end, expires_at, pickup_instructions,
         status, quantity_remaining, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        organization.id,
        actor.user.id,
        input.title,
        input.description ?? '',
        input.category,
        input.quantity,
        input.unit,
        normalizeAllergens(input.allergens),
        input.storage,
        input.pickupAddress,
        input.latitude,
        input.longitude,
        new Date(input.windowStart).toISOString(),
        new Date(input.windowEnd).toISOString(),
        expiresAt,
        input.pickupInstructions ?? '',
        status,
        input.quantity,
        now,
        now,
      ],
    );
    const row = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [id])!;
    return toOwnerListing(ctx.db, row);
  });
}

export function updateListing(
  ctx: ListingContext,
  actor: SessionUser,
  listingId: string,
  patch: Partial<ListingInput>,
): OwnerListing {
  const row = getOwnedListing(ctx.db, listingId, actor.organization?.id ?? null);
  if (row.status === 'CANCELLED') {
    throw conflict('A cancelled listing cannot be edited.', 'LISTING_CANCELLED');
  }
  const nextWindowStart = patch.windowStart ?? row.window_start;
  const nextWindowEnd = patch.windowEnd ?? row.window_end;
  const nextExpires = patch.expiresAt ?? row.expires_at;
  const { expiresAt } = validateWindow({
    windowStart: nextWindowStart,
    windowEnd: nextWindowEnd,
    expiresAt: nextExpires,
  });

  const reserved = reservedQuantity(ctx.db, row.id);
  const nextQuantity = patch.quantity ?? row.quantity;
  if (nextQuantity < reserved) {
    throw conflict(
      `Quantity cannot drop below the ${reserved} ${row.unit} already reserved by recipients.`,
      'QUANTITY_BELOW_RESERVED',
    );
  }

  // Existing reservations must stay inside the (possibly narrowed) pickup window.
  const conflicts = ctx.db.all<ReservationRow>(
    `SELECT * FROM reservations
      WHERE listing_id = ? AND status = 'RESERVED'
        AND (pickup_start < ? OR pickup_end > ?)`,
    [row.id, new Date(nextWindowStart).toISOString(), new Date(nextWindowEnd).toISOString()],
  );
  if (conflicts.length > 0) {
    throw conflict(
      'The new pickup window does not cover existing reservations. Cancel or move those reservations first.',
      'WINDOW_EXCLUDES_RESERVATIONS',
    );
  }

  const delta = nextQuantity - row.quantity;
  const now = nowIso();
  const shipped = Math.max(0, row.quantity - row.quantity_remaining);
  const nextRemaining = Math.max(0, nextQuantity - shipped);

  return ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE listings SET
         title = ?, description = ?, category = ?, quantity = ?, unit = ?, allergens = ?, storage = ?,
         pickup_address = ?, latitude = ?, longitude = ?, window_start = ?, window_end = ?, expires_at = ?,
         pickup_instructions = ?, quantity_remaining = ?, updated_at = ?
       WHERE id = ?`,
      [
        patch.title ?? row.title,
        patch.description ?? row.description,
        patch.category ?? row.category,
        nextQuantity,
        patch.unit ?? row.unit,
        patch.allergens !== undefined ? normalizeAllergens(patch.allergens) : row.allergens,
        patch.storage ?? row.storage,
        patch.pickupAddress ?? row.pickup_address,
        patch.latitude ?? row.latitude,
        patch.longitude ?? row.longitude,
        new Date(nextWindowStart).toISOString(),
        new Date(nextWindowEnd).toISOString(),
        expiresAt,
        patch.pickupInstructions ?? row.pickup_instructions,
        nextRemaining,
        now,
        row.id,
      ],
    );
    // Keep the derived stock status honest after edits.
    if (EXPIRABLE_STATUSES.includes(row.status as ListingStatus)) {
      const refreshed = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.id])!;
      const desired: ListingStatus = isPast(refreshed.expires_at)
        ? 'EXPIRED'
        : refreshed.quantity_remaining <= 0
          ? 'RESERVED_OUT'
          : refreshed.status === 'RESERVED_OUT'
            ? 'ACTIVE'
            : (refreshed.status as ListingStatus);
      if (desired !== refreshed.status) {
        ctx.db.run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [
          desired,
          now,
          row.id,
        ]);
      }
    }
    void delta;
    const updated = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.id])!;
    return toOwnerListing(ctx.db, updated);
  });
}

export function reservedQuantity(db: Db, listingId: string): number {
  const row = db.get<{ reserved: number }>(
    `SELECT COALESCE(SUM(quantity), 0) AS reserved FROM reservations
      WHERE listing_id = ? AND status = 'RESERVED'`,
    [listingId],
  );
  return Number(row?.reserved ?? 0);
}

export function getOwnedListing(db: Db, listingId: string, providerId: string | null): ListingRow {
  const row = db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [listingId]);
  // Non-owners get 404 rather than 403 so the API never confirms the existence of
  // another organization's private listing.
  if (!row || !providerId || row.provider_id !== providerId) throw notFound('Listing not found.');
  return row;
}

export interface StatusActionResult {
  listing: OwnerListing;
  cancelledReservations: number;
}

export function applyStatusAction(
  ctx: ListingContext,
  actor: SessionUser,
  listingId: string,
  action: 'PUBLISH' | 'PAUSE' | 'RESUME' | 'CANCEL',
  reason?: string,
): StatusActionResult {
  const row = getOwnedListing(ctx.db, listingId, actor.organization?.id ?? null);
  const caps = capabilitiesFor(actor.user, actor.organization);
  const now = new Date();
  const nowStr = now.toISOString();
  const current = computeListingStatus(row, now);

  if (action === 'PUBLISH' && !caps.canPublishListing) {
    throw conflict(
      caps.blockedReason ?? 'Your organization must be approved before publishing listings.',
      'ORG_NOT_APPROVED',
    );
  }
  if (TERMINAL_STATUSES.includes(current) && action !== 'CANCEL') {
    throw conflict(`A ${current.toLowerCase()} listing cannot be changed.`, 'LISTING_TERMINAL');
  }
  if (action === 'PUBLISH' && !isPublishable(row, now)) {
    throw conflict('The pickup window has already closed for this listing.', 'WINDOW_CLOSED');
  }

  return ctx.db.transaction(() => {
    let cancelledReservations = 0;
    if (action === 'CANCEL') {
      cancelledReservations = cancelReservationsForListing(ctx.db, row.id, 'PROVIDER', reason);
      ctx.db.run(`UPDATE listings SET status = 'CANCELLED', updated_at = ? WHERE id = ?`, [
        nowStr,
        row.id,
      ]);
    } else {
      const desired: ListingStatus =
        action === 'PAUSE' ? 'PAUSED' : row.quantity_remaining <= 0 ? 'RESERVED_OUT' : 'ACTIVE';
      ctx.db.run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [
        desired,
        nowStr,
        row.id,
      ]);
    }
    const refreshed = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.id])!;
    return { listing: toOwnerListing(ctx.db, refreshed, now), cancelledReservations };
  });
}

export function cancelReservationsForListing(
  db: Db,
  listingId: string,
  cancelledBy: 'PROVIDER' | 'ADMIN',
  reason?: string,
): number {
  const active = db.all<ReservationRow>(
    `SELECT * FROM reservations WHERE listing_id = ? AND status = 'RESERVED'`,
    [listingId],
  );
  const nowStr = nowIso();
  for (const reservation of active) {
    db.run(
      `UPDATE reservations
         SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?
       WHERE id = ?`,
      [nowStr, cancelledBy, reason || 'Listing cancelled by the provider.', nowStr, reservation.id],
    );
  }
  return active.length;
}

export function listProviderListings(
  ctx: ListingContext,
  actor: SessionUser,
  status?: string,
): OwnerListing[] {
  const organizationId = actor.organization?.id;
  if (!organizationId) return [];
  const rows = ctx.db.all<ListingRow>(
    `SELECT * FROM listings WHERE provider_id = ? ORDER BY
       CASE status WHEN 'ACTIVE' THEN 0 WHEN 'RESERVED_OUT' THEN 1 WHEN 'PAUSED' THEN 2 WHEN 'DRAFT' THEN 3 ELSE 4 END,
       window_end ASC`,
    [organizationId],
  );
  const now = new Date();
  const views = rows.map((row) => toOwnerListing(ctx.db, row, now));
  if (!status || status === 'ALL') return views;
  if (status === 'EXPIRED') return views.filter((v) => v.status === 'EXPIRED');
  return views.filter((v) => v.status === status);
}

export interface VisibilityResult {
  row: ListingRow;
  isOwner: boolean;
  isAdmin: boolean;
}

export function getListingForViewer(
  db: Db,
  listingId: string,
  viewer: SessionUser | null,
): VisibilityResult {
  const row = db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [listingId]);
  if (!row) throw notFound('Listing not found.');
  const isOwner = Boolean(viewer?.organization && row.provider_id === viewer.organization.id);
  const isAdmin = viewer?.user.role === 'ADMIN';
  const effective = computeListingStatus(row);
  if (effective !== 'ACTIVE' && effective !== 'RESERVED_OUT' && !isOwner && !isAdmin) {
    // Draft / paused / cancelled / expired listings are private to their owner.
    throw notFound('Listing not found.');
  }
  return { row, isOwner, isAdmin };
}

export function searchListings(ctx: ListingContext, query: SearchQuery): SearchResponse {
  const { db, config } = ctx;
  const now = new Date();
  sweepStatuses(db, now);

  const radiusKm = Math.min(
    config.searchMaxRadiusKm,
    query.radius_km ?? config.searchDefaultRadiusKm,
  );
  const hasCenter = typeof query.lat === 'number' && typeof query.lng === 'number';
  const center = hasCenter ? { latitude: query.lat!, longitude: query.lng! } : null;

  let sql = `
    SELECT l.* FROM listings l
    JOIN organizations o ON o.id = l.provider_id
    WHERE l.status = 'ACTIVE'
      AND l.expires_at > ?
      AND l.quantity_remaining > 0
      AND o.status = 'APPROVED'
      AND o.role = 'PROVIDER'`;
  const params: unknown[] = [now.toISOString()];

  if (center) {
    // Bounding-box prefilter first (index-friendly), Haversine afterwards in JS.
    const box = boundingBox(center, radiusKm);
    sql += ' AND l.latitude BETWEEN ? AND ? AND l.longitude BETWEEN ? AND ?';
    params.push(box.minLat, box.maxLat, box.minLng, box.maxLng);
  }

  sql += ' ORDER BY l.expires_at ASC LIMIT 500';

  const rows = db.all<ListingRow>(sql, params);
  const filtered = rows
    .map((row) => {
      if (!center) return { row, distanceKm: null as number | null };
      const distanceKm = haversineKm(center, {
        latitude: row.latitude,
        longitude: row.longitude,
      });
      return { row, distanceKm };
    })
    .filter((item) => (center ? item.distanceKm! <= radiusKm : true));

  const facets = {
    storages: new Set(filtered.map((item) => item.row.storage)),
    categories: new Set(filtered.map((item) => item.row.category)),
  };

  let results = filtered;
  if (query.storage) results = results.filter((item) => item.row.storage === query.storage);
  if (query.category) results = results.filter((item) => item.row.category === query.category);
  if (query.q) {
    const needle = query.q.toLowerCase();
    results = results.filter(
      (item) =>
        item.row.title.toLowerCase().includes(needle) ||
        item.row.description.toLowerCase().includes(needle),
    );
  }

  const sorted = [...results].sort((a, b) => {
    if (query.sort === 'ending_soon') {
      const diff = Date.parse(a.row.expires_at) - Date.parse(b.row.expires_at);
      if (diff !== 0) return diff;
    }
    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    return Date.parse(a.row.expires_at) - Date.parse(b.row.expires_at);
  });

  return {
    listings: sorted.map((item) =>
      toPublicListing(db, item.row, { distanceKm: item.distanceKm, now }),
    ),
    count: sorted.length,
    center,
    radiusKm,
    sort: query.sort,
    availableStorage: [...facets.storages].sort(),
    availableCategories: [...facets.categories].sort(),
  };
}

export { EXPIRABLE_STATUSES, TERMINAL_STATUSES };
