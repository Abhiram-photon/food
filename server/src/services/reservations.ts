import type { AppConfig } from '../config';
import { Db } from '../db';
import type { ListingRow, OrganizationRow, ReservationRow, UserRow } from '../db/types';
import {
  decryptPickupCode,
  encryptPickupCode,
  generatePickupCode,
  hashPickupCode,
  newId,
  verifyPickupCode as verifyPickupCodeHash,
} from '../lib/crypto';
import { badRequest, conflict, forbidden, locked, notFound } from '../lib/errors';
import { nowIso } from '../lib/time';
import type { EmailSender } from '../emails/sender';
import { capabilitiesFor, requireApprovedOrganization, type SessionUser } from './auth';
import { computeListingStatus, sweepStatuses } from './listings';
import { notifyOrganization } from './notifications';
import type { CreateReservationInput } from '../schemas/reservations';
import type { ReservationView, CreateReservationResponse } from '../schemas/reservations';

export interface ReservationContext {
  db: Db;
  config: AppConfig;
  emailSender: EmailSender;
}

export interface PickupSlot {
  pickupStart: string;
  pickupEnd: string;
}

/** Resolves and validates the pickup slot against the listing window and expiry. */
export function resolvePickupSlot(
  listing: ListingRow,
  input: Pick<CreateReservationInput, 'pickupStart' | 'pickupEnd'>,
  now: Date = new Date(),
): PickupSlot {
  const windowStart = Date.parse(listing.window_start);
  const windowEnd = Date.parse(listing.window_end);
  const expiresAt = Date.parse(listing.expires_at);
  const nowMs = now.getTime();

  if (nowMs > expiresAt) throw conflict('This listing has expired.', 'LISTING_EXPIRED');
  if (nowMs > windowEnd) {
    throw conflict('The pickup window for this listing has already closed.', 'WINDOW_CLOSED');
  }

  const start = input.pickupStart ? Date.parse(input.pickupStart) : Math.max(nowMs, windowStart);
  const end = input.pickupEnd ? Date.parse(input.pickupEnd) : windowEnd;
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw badRequest('Pickup slot is invalid.');
  if (start < windowStart || end > windowEnd) {
    throw badRequest('Your pickup slot must fall inside the provider pickup window.', {
      windowStart: listing.window_start,
      windowEnd: listing.window_end,
    });
  }
  if (end <= start) throw badRequest('Pickup slot end must be after the pickup slot start.');
  if (end <= nowMs) {
    throw badRequest('Your pickup slot must end in the future.', { pickupEnd: new Date(end).toISOString() });
  }
  return {
    pickupStart: new Date(Math.max(start, nowMs)).toISOString(),
    pickupEnd: new Date(end).toISOString(),
  };
}

export function createReservation(
  ctx: ReservationContext,
  actor: SessionUser,
  listingId: string,
  input: CreateReservationInput,
): CreateReservationResponse {
  const now = new Date();
  sweepStatuses(ctx.db, now);

  if (actor.user.role !== 'RECIPIENT') {
    throw forbidden('Only recipient organizations can reserve food.', 'WRONG_ROLE');
  }
  const organization = requireApprovedOrganization(actor);

  const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [listingId]);
  if (!listing) throw notFound('Listing not found.');

  const status = computeListingStatus(listing, now);
  if (status === 'RESERVED_OUT') {
    throw conflict('This listing is fully reserved.', 'RESERVED_OUT');
  }
  if (status !== 'ACTIVE') {
    throw conflict(`This listing is not open for reservations (status: ${status}).`, 'LISTING_NOT_ACTIVE');
  }

  const provider = ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [
    listing.provider_id,
  ]);
  if (!provider || provider.status !== 'APPROVED') {
    throw conflict('This provider is not approved to receive reservations.', 'PROVIDER_NOT_APPROVED');
  }

  const quantity = Number(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw badRequest('Requested quantity must be at least 1.');
  }
  if (quantity > listing.quantity_remaining) {
    throw conflict(
      `Only ${listing.quantity_remaining} ${listing.unit} left on this listing.`,
      'INSUFFICIENT_STOCK',
      { remaining: listing.quantity_remaining },
    );
  }

  const slot = resolvePickupSlot(listing, input, now);

  // The 6-digit code is generated up-front. Its hash is salted with the reservation
  // id, so the id must exist before hashing — hence the two-step generation here.
  const code = generatePickupCode();
  const reservationId = newId();
  const codeHash = hashPickupCode(code, reservationId, ctx.config.appSecret);

  const result = ctx.db.transaction(() => {
    // Re-read inside the immediate transaction: this is the authoritative stock check.
    const fresh = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [listingId]);
    if (!fresh) throw notFound('Listing not found.');
    const freshStatus = computeListingStatus(fresh, new Date());
    if (freshStatus !== 'ACTIVE') {
      throw conflict(
        freshStatus === 'RESERVED_OUT'
          ? 'This listing was just fully reserved by someone else.'
          : `This listing is not open for reservations (status: ${freshStatus}).`,
        freshStatus === 'RESERVED_OUT' ? 'RESERVED_OUT' : 'LISTING_NOT_ACTIVE',
      );
    }
    if (quantity > fresh.quantity_remaining) {
      throw conflict(
        `Only ${fresh.quantity_remaining} ${fresh.unit} left on this listing.`,
        'INSUFFICIENT_STOCK',
        { remaining: fresh.quantity_remaining },
      );
    }

    const remaining = Math.round((fresh.quantity_remaining - quantity) * 1000) / 1000;
    ctx.db.run('UPDATE listings SET quantity_remaining = ?, updated_at = ? WHERE id = ?', [
      remaining,
      now.toISOString(),
      listingId,
    ]);

    ctx.db.run(
      `INSERT INTO reservations
        (id, listing_id, recipient_id, created_by, quantity, unit, pickup_start, pickup_end, status,
         code_hash, code_encrypted, code_attempts, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?, 0, ?, ?, ?)`,
      [
        reservationId,
        listingId,
        organization.id,
        actor.user.id,
        quantity,
        fresh.unit,
        slot.pickupStart,
        slot.pickupEnd,
        codeHash,
        encryptPickupCode(code, ctx.config.appSecret),
        input.note ?? '',
        now.toISOString(),
        now.toISOString(),
      ],
    );

    const nextStatus = remaining <= 0 ? 'RESERVED_OUT' : 'ACTIVE';
    ctx.db.run('UPDATE listings SET status = ?, updated_at = ? WHERE id = ?', [
      nextStatus,
      now.toISOString(),
      listingId,
    ]);

    notifyOrganization(ctx.db, fresh.provider_id, {
      type: 'RESERVATION_CREATED',
      title: `New reservation: ${fresh.title}`,
      body: `${organization.name} reserved ${quantity} ${fresh.unit} for pickup between ${slot.pickupStart} and ${slot.pickupEnd}.`,
      link: `/provider`,
      entityId: reservationId,
    });

    const created = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [
      reservationId,
    ])!;
    return { created, listingStatus: nextStatus, quantityRemaining: remaining };
  });

  const view = toReservationView(ctx, result.created, { revealCode: true });
  void ctx.emailSender.send({
    to: provider.contact_email,
    subject: `FreshRelay: new reservation for ${listing.title}`,
    body: `${organization.name} reserved ${quantity} ${listing.unit}. Pickup window: ${slot.pickupStart} – ${slot.pickupEnd}. Code verification happens at pickup.`,
    template: 'reservation-created',
  });

  return {
    reservation: view,
    pickupCode: code,
    listingStatus: result.listingStatus,
    quantityRemaining: result.quantityRemaining,
  };
}

export function toReservationView(
  ctx: { db: Db; config: AppConfig },
  row: ReservationRow,
  options: { revealCode?: boolean; viewer?: SessionUser | null } = {},
): ReservationView {
  const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.listing_id]);
  const provider = listing
    ? ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [listing.provider_id])
    : undefined;
  const recipient = ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [
    row.recipient_id,
  ]);
  const viewer = options.viewer ?? null;
  const isRecipientOwner = viewer?.organization?.id === row.recipient_id;
  const isProviderOwner = viewer?.organization?.id === listing?.provider_id;
  const isAdmin = viewer?.user.role === 'ADMIN';
  const maySeeAddress = isRecipientOwner || isProviderOwner || isAdmin;
  const maySeeCode = options.revealCode ?? isRecipientOwner;

  let code: string | null = null;
  if (maySeeCode) {
    code = decryptPickupCode(row.code_encrypted, ctx.config.appSecret);
  }

  return {
    id: row.id,
    listingId: row.listing_id,
    listingTitle: listing?.title ?? 'Listing removed',
    listingUnit: listing?.unit ?? row.unit,
    listingCategory: listing?.category ?? 'OTHER',
    listingStorage: listing?.storage ?? 'AMBIENT',
    status: row.status,
    quantity: row.quantity,
    unit: row.unit,
    pickupStart: row.pickup_start,
    pickupEnd: row.pickup_end,
    windowEnd: listing?.window_end ?? row.pickup_end,
    createdAt: row.created_at,
    collectedAt: row.collected_at,
    cancelledAt: row.cancelled_at,
    cancelReason: row.cancel_reason,
    cancelledBy: row.cancelled_by,
    codeAttempts: row.code_attempts,
    locked: Boolean(row.locked_at),
    code,
    codeRevealed: code !== null,
    provider: { id: provider?.id ?? '', name: provider?.name ?? 'Unknown provider' },
    recipient: { id: recipient?.id ?? '', name: recipient?.name ?? 'Unknown recipient' },
    pickupAddress: maySeeAddress ? (listing?.pickup_address ?? null) : null,
    pickupInstructions: maySeeAddress ? (listing?.pickup_instructions ?? null) : null,
  };
}

export function listReservationsForRecipient(
  ctx: ReservationContext,
  actor: SessionUser,
): ReservationView[] {
  const organizationId = actor.organization?.id;
  if (!organizationId) return [];
  sweepStatuses(ctx.db);
  const rows = ctx.db.all<ReservationRow>(
    `SELECT * FROM reservations WHERE recipient_id = ? ORDER BY created_at DESC`,
    [organizationId],
  );
  return rows.map((row) => toReservationView(ctx, row, { viewer: actor, revealCode: true }));
}

export function listReservationsForProvider(
  ctx: ReservationContext,
  actor: SessionUser,
  options: { listingId?: string; status?: string } = {},
): ReservationView[] {
  const organizationId = actor.organization?.id;
  if (!organizationId) return [];
  sweepStatuses(ctx.db);
  const params: unknown[] = [organizationId];
  let sql = `SELECT r.* FROM reservations r
             JOIN listings l ON l.id = r.listing_id
             WHERE l.provider_id = ?`;
  if (options.listingId) {
    sql += ' AND r.listing_id = ?';
    params.push(options.listingId);
  }
  sql += ` ORDER BY CASE r.status WHEN 'RESERVED' THEN 0 ELSE 1 END, r.created_at DESC LIMIT 200`;
  const rows = ctx.db.all<ReservationRow>(sql, params);
  // Providers deliberately never see the pickup code: the recipient shows it at pickup,
  // and the code is the proof of handover (see docs/DECISIONS.md).
  const views = rows.map((row) => toReservationView(ctx, row, { viewer: actor, revealCode: false }));
  if (!options.status || options.status === 'ALL') return views;
  return views.filter((view) => view.status === options.status);
}

export function getReservationForViewer(
  ctx: ReservationContext,
  viewer: SessionUser | null,
  reservationId: string,
): ReservationView {
  const row = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!row) throw notFound('Reservation not found.');
  const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.listing_id]);
  const isRecipientOwner = viewer?.organization?.id === row.recipient_id;
  const isProviderOwner = Boolean(listing && viewer?.organization?.id === listing.provider_id);
  const isAdmin = viewer?.user.role === 'ADMIN';
  if (!isRecipientOwner && !isProviderOwner && !isAdmin) {
    throw notFound('Reservation not found.');
  }
  return toReservationView(ctx, row, { viewer, revealCode: isRecipientOwner || isAdmin });
}

/** Restores stock and recomputes the listing status after a cancellation. */
function restoreStock(db: Db, listingId: string, quantity: number, now: Date): void {
  const listing = db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [listingId]);
  if (!listing) return;
  const remaining = Math.round((listing.quantity_remaining + quantity) * 1000) / 1000;
  db.run('UPDATE listings SET quantity_remaining = ?, updated_at = ? WHERE id = ?', [
    remaining,
    now.toISOString(),
    listingId,
  ]);
  const status = computeListingStatus(listing, now);
  if (status === 'RESERVED_OUT' && remaining > 0) {
    db.run(`UPDATE listings SET status = 'ACTIVE', updated_at = ? WHERE id = ?`, [
      now.toISOString(),
      listingId,
    ]);
  }
}

export function cancelReservation(
  ctx: ReservationContext,
  actor: SessionUser,
  reservationId: string,
  reason?: string,
): ReservationView {
  const row = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [reservationId]);
  if (!row) throw notFound('Reservation not found.');
  const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.listing_id]);
  if (!listing) throw notFound('Listing not found.');

  const isRecipientOwner = actor.organization?.id === row.recipient_id;
  const isProviderOwner = actor.organization?.id === listing.provider_id;
  const isAdmin = actor.user.role === 'ADMIN';
  if (!isRecipientOwner && !isProviderOwner && !isAdmin) throw notFound('Reservation not found.');

  if (row.status !== 'RESERVED') {
    throw conflict(`This reservation is already ${row.status.toLowerCase()}.`, 'RESERVATION_NOT_ACTIVE');
  }
  if (isProviderOwner && !isRecipientOwner && !reason?.trim()) {
    throw badRequest('A reason is required when the provider cancels a reservation.');
  }

  const cancelledBy = isAdmin && !isRecipientOwner && !isProviderOwner
    ? 'ADMIN'
    : isProviderOwner && !isRecipientOwner
      ? 'PROVIDER'
      : 'RECIPIENT';
  const now = new Date();

  const updated = ctx.db.transaction(() => {
    ctx.db.run(
      `UPDATE reservations
         SET status = 'CANCELLED', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, updated_at = ?
       WHERE id = ? AND status = 'RESERVED'`,
      [now.toISOString(), cancelledBy, reason?.trim() || null, now.toISOString(), reservationId],
    );
    const fresh = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [
      reservationId,
    ])!;
    if (fresh.status === 'CANCELLED') {
      restoreStock(ctx.db, row.listing_id, row.quantity, now);
    }
    return fresh;
  });

  // Notifications + email happen after the transaction commits.
  notifyCancellation(ctx, row, listing, cancelledBy, reason, isProviderOwner);
  return toReservationView(ctx, updated, { viewer: actor, revealCode: true });
}

function notifyCancellation(
  ctx: ReservationContext,
  row: ReservationRow,
  listing: ListingRow,
  cancelledBy: string,
  reason: string | undefined,
  byProvider: boolean,
): void {
  const targetOrg = byProvider ? row.recipient_id : listing.provider_id;
  const title =
    cancelledBy === 'RECIPIENT'
      ? `Reservation cancelled: ${listing.title}`
      : `${cancelledBy === 'PROVIDER' ? 'Provider' : 'Admin'} cancelled a reservation: ${listing.title}`;
  notifyOrganization(ctx.db, targetOrg, {
    type: 'RESERVATION_CANCELLED',
    title,
    body: `${row.quantity} ${row.unit} released${reason ? ` — reason: ${reason}` : ''}.`,
    link: byProvider ? '/recipient' : '/provider',
    entityId: row.id,
  });
  const contact = ctx.db.get<OrganizationRow>('SELECT * FROM organizations WHERE id = ?', [
    targetOrg,
  ]);
  if (contact) {
    void ctx.emailSender.send({
      to: contact.contact_email,
      subject: title,
      body: `${row.quantity} ${row.unit} for "${listing.title}" was cancelled${reason ? `: ${reason}` : '.'}`,
      template: 'reservation-cancelled',
    });
  }
}

export interface VerifyResult {
  reservation: ReservationView;
  attemptsRemaining: number;
}

/**
 * Verifies a pickup code. Order matters: ownership → state → lock → time window →
 * code. A wrong-time attempt never burns an attempt or locks the reservation.
 */
export function verifyPickupCode(
  ctx: ReservationContext,
  actor: SessionUser,
  input: { code: string; reservationId?: string },
): VerifyResult {
  if (actor.user.role !== 'PROVIDER') {
    throw forbidden('Only providers can verify pickup codes.', 'WRONG_ROLE');
  }
  requireApprovedOrganization(actor);
  const organizationId = actor.organization!.id;
  const now = new Date();

  let row: ReservationRow | undefined;
  if (input.reservationId) {
    row = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [
      input.reservationId,
    ]);
    if (!row) throw notFound('Reservation not found.');
    const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.listing_id]);
    if (!listing || listing.provider_id !== organizationId) throw notFound('Reservation not found.');
  } else {
    // Code-only verification (the "type the code" flow): locate the reservation whose
    // salted hash matches. Pending reservations are searched first, then finished ones
    // so a reused code reports CODE_ALREADY_USED instead of a vague "unknown code".
    const candidates = ctx.db.all<ReservationRow>(
      `SELECT r.* FROM reservations r
        JOIN listings l ON l.id = r.listing_id
        WHERE l.provider_id = ?
        ORDER BY CASE r.status WHEN 'RESERVED' THEN 0 WHEN 'COLLECTED' THEN 1 ELSE 2 END,
                 r.created_at DESC
        LIMIT 500`,
      [organizationId],
    );
    row = candidates.find((candidate) =>
      verifyPickupCodeFor(candidate, input.code, ctx.config.appSecret),
    );
    if (!row) {
      // Without a target reservation there is nothing to attach a failed attempt to,
      // so this branch intentionally does not consume verification attempts.
      throw badRequest('That code does not match any reservation for your organization.', {
        code: 'CODE_INVALID',
      });
    }
  }

  const listing = ctx.db.get<ListingRow>('SELECT * FROM listings WHERE id = ?', [row.listing_id])!;

  if (row.status === 'COLLECTED') {
    throw conflict('This pickup code has already been used.', 'CODE_ALREADY_USED');
  }
  if (row.status !== 'RESERVED') {
    throw conflict(`This reservation is ${row.status.toLowerCase()}.`, 'RESERVATION_NOT_ACTIVE');
  }
  if (row.locked_at) {
    throw locked('This reservation is locked after too many incorrect code attempts. Contact an admin.');
  }

  const startMs = Date.parse(row.pickup_start);
  const endMs = Math.min(Date.parse(row.pickup_end), Date.parse(listing.window_end));
  if (now.getTime() < startMs) {
    throw conflict(
      `The pickup window has not started yet. It opens at ${new Date(startMs).toISOString()}.`,
      'PICKUP_NOT_STARTED',
    );
  }
  if (now.getTime() > endMs) {
    throw conflict(
      `The pickup window closed at ${new Date(endMs).toISOString()}.`,
      'PICKUP_WINDOW_CLOSED',
    );
  }

  if (!verifyPickupCodeFor(row, input.code, ctx.config.appSecret)) {
    const attempts = row.code_attempts + 1;
    const lockedAt = attempts >= ctx.config.maxVerifyAttempts ? now.toISOString() : null;
    ctx.db.run('UPDATE reservations SET code_attempts = ?, locked_at = ?, updated_at = ? WHERE id = ?', [
      attempts,
      lockedAt,
      now.toISOString(),
      row.id,
    ]);
    const attemptsRemaining = Math.max(0, ctx.config.maxVerifyAttempts - attempts);
    if (lockedAt) {
      throw locked(
        `Incorrect code. The reservation is now locked after ${ctx.config.maxVerifyAttempts} failed attempts.`,
      );
    }
    throw badRequest(
      `Incorrect pickup code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? '' : 's'} remaining.`,
      { code: 'CODE_INVALID', attemptsRemaining },
    );
  }

  const updated = ctx.db.transaction(() => {
    const current = ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [row!.id])!;
    if (current.status !== 'RESERVED') {
      throw conflict('This reservation is no longer available to verify.', 'RESERVATION_NOT_ACTIVE');
    }
    ctx.db.run(
      `UPDATE reservations SET status = 'COLLECTED', collected_at = ?, code_attempts = 0, updated_at = ?
       WHERE id = ?`,
      [now.toISOString(), now.toISOString(), current.id],
    );
    return ctx.db.get<ReservationRow>('SELECT * FROM reservations WHERE id = ?', [current.id])!;
  });

  notifyOrganization(ctx.db, updated.recipient_id, {
    type: 'PICKUP_VERIFIED',
    title: `Pickup verified: ${listing.title}`,
    body: `${updated.quantity} ${updated.unit} collected. Thanks for rescuing food!`,
    link: '/recipient',
    entityId: updated.id,
  });
  notifyOrganization(ctx.db, listing.provider_id, {
    type: 'PICKUP_VERIFIED',
    title: `Pickup verified: ${listing.title}`,
    body: `${updated.quantity} ${updated.unit} handed over and logged as rescued food.`,
    link: '/provider',
    entityId: updated.id,
  });

  return {
    reservation: toReservationView(ctx, updated, { viewer: actor, revealCode: true }),
    attemptsRemaining: ctx.config.maxVerifyAttempts,
  };
}

function verifyPickupCodeFor(row: ReservationRow, code: string, secret: string): boolean {
  return verifyPickupCodeHash(code, row.id, secret, row.code_hash);
}

/** Used by the seed and tests: reveal a stored code (server-side only). */
export function readStoredCode(config: AppConfig, row: ReservationRow): string | null {
  return decryptPickupCode(row.code_encrypted, config.appSecret);
}

export function describeCapabilities(actor: SessionUser) {
  return capabilitiesFor(actor.user, actor.organization);
}

export function getUserContact(db: Db, userId: string): UserRow | undefined {
  return db.get<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
}

export { capabilitiesFor };
