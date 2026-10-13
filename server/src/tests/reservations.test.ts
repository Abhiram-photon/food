import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createListingFixture,
  createTestHarness,
  createUser,
  inject,
  type TestHarness,
  type TestUser,
} from './helpers';

describe('reservations: stock control, validation and concurrency', () => {
  let harness: TestHarness;
  let provider: TestUser;
  let recipient: TestUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    provider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'provider@reservations.test',
      organizationName: 'Reservation Bakery',
      orgStatus: 'APPROVED',
    });
    recipient = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'recipient@reservations.test',
      organizationName: 'Reservation Food Bank',
      orgStatus: 'APPROVED',
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('rejects a quantity above the remaining stock', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 6 },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects a quantity below 1', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 0 },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a reservation after the pickup window has ended', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      windowStart: new Date(Date.now() - 3 * 3600_000),
      windowEnd: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 60_000),
      status: 'ACTIVE',
    });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(409);
    expect(['WINDOW_CLOSED', 'LISTING_NOT_ACTIVE', 'LISTING_EXPIRED']).toContain(
      response.body.error.code,
    );
  });

  it('rejects a pickup slot outside the provider window', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      windowStart: new Date(Date.now() - 60_000),
      windowEnd: new Date(Date.now() + 2 * 3600_000),
    });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: {
        quantity: 1,
        pickupStart: new Date(Date.now() + 3600_000).toISOString(),
        pickupEnd: new Date(Date.now() + 5 * 3600_000).toISOString(),
      },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.message).toContain('pickup window');
  });

  it('decrements stock, returns a 6-digit code once and flips to RESERVED_OUT at zero', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 3,
      quantityRemaining: 3,
    });
    const first = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 3 },
      cookie: recipient.cookie,
    });
    expect(first.status).toBe(201);
    expect(first.body.pickupCode).toMatch(/^\d{6}$/);
    expect(first.body.reservation.code).toMatch(/^\d{6}$/);
    expect(first.body.reservation.code).toBe(first.body.pickupCode);
    expect(first.body.listingStatus).toBe('RESERVED_OUT');
    expect(first.body.quantityRemaining).toBe(0);

    const row = harness.db.get<{ status: string; quantity_remaining: number }>(
      'SELECT status, quantity_remaining FROM listings WHERE id = ?',
      [listing.id],
    )!;
    expect(row.status).toBe('RESERVED_OUT');
    expect(row.quantity_remaining).toBe(0);

    // The stored code is a hash, never plaintext.
    const stored = harness.db.get<{ code_hash: string; code_encrypted: string }>(
      'SELECT code_hash, code_encrypted FROM reservations WHERE id = ?',
      [first.body.reservation.id],
    )!;
    expect(stored.code_hash).toHaveLength(64);
    expect(stored.code_hash).not.toContain(first.body.pickupCode);
    expect(stored.code_encrypted).not.toContain(first.body.pickupCode);
  });

  it('refuses further reservations once the listing is RESERVED_OUT', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 2,
      quantityRemaining: 0,
      status: 'RESERVED_OUT',
    });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('RESERVED_OUT');
  });

  it('returns the pickup code again on the recipient reservations page', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 4,
      quantityRemaining: 4,
    });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 2 },
      cookie: recipient.cookie,
    });
    const response = await inject(harness.app, {
      url: '/api/reservations',
      cookie: recipient.cookie,
    });
    const mine = response.body.reservations.find(
      (r: { id: string }) => r.id === created.body.reservation.id,
    );
    expect(mine.code).toBe(created.body.pickupCode);
    expect(mine.pickupAddress).toBe('1 Test Street, Hyderabad');

    // The provider sees the reservation but not the code.
    const providerView = await inject(harness.app, {
      url: '/api/reservations',
      cookie: provider.cookie,
    });
    const asProvider = providerView.body.reservations.find(
      (r: { id: string }) => r.id === created.body.reservation.id,
    );
    expect(asProvider).toBeDefined();
    expect(asProvider.code).toBeNull();
  });

  it('restores stock when the recipient cancels, and the listing returns to ACTIVE', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 5 },
      cookie: recipient.cookie,
    });
    expect(created.body.listingStatus).toBe('RESERVED_OUT');

    const cancel = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${created.body.reservation.id}/cancel`,
      payload: { reason: 'Van broke down' },
      cookie: recipient.cookie,
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.reservation.status).toBe('CANCELLED');
    expect(cancel.body.reservation.cancelledBy).toBe('RECIPIENT');

    const row = harness.db.get<{ status: string; quantity_remaining: number }>(
      'SELECT status, quantity_remaining FROM listings WHERE id = ?',
      [listing.id],
    )!;
    expect(row.quantity_remaining).toBe(5);
    expect(row.status).toBe('ACTIVE');

    const again = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 5 },
      cookie: recipient.cookie,
    });
    expect(again.status).toBe(201);
  });

  it('lets the provider cancel with a reason and requires that reason', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 2 },
      cookie: recipient.cookie,
    });

    const withoutReason = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${created.body.reservation.id}/cancel`,
      payload: {},
      cookie: provider.cookie,
    });
    expect(withoutReason.status).toBe(400);

    const withReason = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${created.body.reservation.id}/cancel`,
      payload: { reason: 'Pickup no-show' },
      cookie: provider.cookie,
    });
    expect(withReason.status).toBe(200);
    expect(withReason.body.reservation.cancelReason).toBe('Pickup no-show');
    expect(withReason.body.reservation.cancelledBy).toBe('PROVIDER');
  });

  it('cancels a listing’s reservations when the provider cancels the listing', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 4,
      quantityRemaining: 4,
      status: 'ACTIVE',
    });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 4 },
      cookie: recipient.cookie,
    });
    const cancelled = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/status`,
      payload: { action: 'CANCEL', reason: 'Stock spoiled' },
      cookie: provider.cookie,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.cancelledReservations).toBe(1);

    const reservation = await inject(harness.app, {
      url: `/api/reservations/${created.body.reservation.id}`,
      cookie: recipient.cookie,
    });
    expect(reservation.body.reservation.status).toBe('CANCELLED');
    expect(reservation.body.reservation.cancelReason).toBe('Stock spoiled');
  });

  it('fires 20 parallel reservations for 5 units: exactly 5 succeed and the listing ends RESERVED_OUT', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
      status: 'ACTIVE',
    });

    const requests = Array.from({ length: 20 }, () =>
      inject(harness.app, {
        method: 'POST',
        url: `/api/listings/${listing.id}/reservations`,
        payload: { quantity: 1 },
        cookie: recipient.cookie,
      }),
    );
    const results = await Promise.all(requests);

    const succeeded = results.filter((r) => r.status === 201);
    const conflicts = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(5);
    expect(conflicts).toHaveLength(15);
    for (const conflict of conflicts) {
      expect(['RESERVED_OUT', 'INSUFFICIENT_STOCK', 'LISTING_NOT_ACTIVE']).toContain(
        conflict.body.error.code,
      );
    }

    const row = harness.db.get<{ status: string; quantity_remaining: number }>(
      'SELECT status, quantity_remaining FROM listings WHERE id = ?',
      [listing.id],
    )!;
    expect(row.status).toBe('RESERVED_OUT');
    expect(row.quantity_remaining).toBe(0);

    const reserved = harness.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM reservations WHERE listing_id = ? AND status = 'RESERVED'`,
      [listing.id],
    )!;
    expect(Number(reserved.count)).toBe(5);

    // Every successful reservation got a distinct code.
    const codes = new Set(succeeded.map((r) => r.body.pickupCode));
    expect(codes.size).toBe(5);
  });

  it('keeps stock consistent under 20 parallel mixed-quantity requests', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 10,
      quantityRemaining: 10,
      status: 'ACTIVE',
    });
    const requests = Array.from({ length: 20 }, (_, index) =>
      inject(harness.app, {
        method: 'POST',
        url: `/api/listings/${listing.id}/reservations`,
        payload: { quantity: index % 2 === 0 ? 2 : 1 },
        cookie: recipient.cookie,
      }),
    );
    const results = await Promise.all(requests);
    const granted = results
      .filter((r) => r.status === 201)
      .reduce((sum, r) => sum + (r.body.reservation.quantity as number), 0);
    const row = harness.db.get<{ quantity_remaining: number }>(
      'SELECT quantity_remaining FROM listings WHERE id = ?',
      [listing.id],
    )!;
    expect(row.quantity_remaining).toBeCloseTo(10 - granted, 5);
    expect(granted).toBeLessThanOrEqual(10);
  });

  it('notifies the provider when a reservation is created', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 3,
      quantityRemaining: 3,
    });
    await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });
    const notifications = await inject(harness.app, {
      url: '/api/notifications',
      cookie: provider.cookie,
    });
    expect(
      notifications.body.notifications.some(
        (n: { type: string }) => n.type === 'RESERVATION_CREATED',
      ),
    ).toBe(true);
    expect(notifications.body.unreadCount).toBeGreaterThan(0);
    expect(harness.emailSender.sent.length).toBeGreaterThan(0);
  });
});
