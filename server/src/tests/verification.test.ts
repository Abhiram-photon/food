import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPickupCode } from '../lib/crypto';
import { mealsEstimate } from '../services/impact';
import {
  createListingFixture,
  createTestHarness,
  createUser,
  getReservationCode,
  inject,
  setReservationWindow,
  type TestHarness,
  type TestUser,
} from './helpers';

describe('pickup code verification', () => {
  let harness: TestHarness;
  let provider: TestUser;
  let otherProvider: TestUser;
  let recipient: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    provider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'provider@verify.test',
      organizationName: 'Verify Kitchen',
      orgStatus: 'APPROVED',
    });
    otherProvider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'other@verify.test',
      organizationName: 'Other Kitchen',
      orgStatus: 'APPROVED',
    });
    recipient = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'recipient@verify.test',
      organizationName: 'Verify Food Bank',
      orgStatus: 'APPROVED',
    });
    admin = await createUser(harness.db, {
      role: 'ADMIN',
      email: 'admin@verify.test',
      orgStatus: null,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  async function reserve(listingId: string, quantity = 2) {
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listingId}/reservations`,
      payload: { quantity },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(201);
    return response.body.reservation.id as string;
  }

  it('rejects a code that matches nothing for this provider', async () => {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code: '000000' },
      cookie: provider.cookie,
    });
    expect(response.status).toBe(400);
    expect(response.body.error.details.code).toBe('CODE_INVALID');
  });

  it('hashes codes with the reservation id salt (no plaintext, no reusable hash)', () => {
    const code = '123456';
    const a = hashPickupCode(code, 'reservation-a', 'secret');
    const b = hashPickupCode(code, 'reservation-b', 'secret');
    expect(a).not.toEqual(b);
    expect(a).toHaveLength(64);
  });

  it('accepts the correct code once and refuses the second use', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const reservationId = await reserve(listing.id);
    const code = getReservationCode(harness.db, harness.config, reservationId);

    const first = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code },
      cookie: provider.cookie,
    });
    expect(first.status).toBe(200);
    expect(first.body.reservation.status).toBe('COLLECTED');
    expect(first.body.reservation.collectedAt).toBeTruthy();

    const second = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code },
      cookie: provider.cookie,
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('CODE_ALREADY_USED');

    // The second use must not re-run the collection bookkeeping.
    const row = harness.db.get<{ status: string; collected_at: string | null }>(
      'SELECT status, collected_at FROM reservations WHERE id = ?',
      [reservationId],
    )!;
    expect(row.status).toBe('COLLECTED');
    expect(row.collected_at).toBe(first.body.reservation.collectedAt);
  });

  it('locks the reservation after 5 wrong attempts', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const reservationId = await reserve(listing.id);
    const correct = getReservationCode(harness.db, harness.config, reservationId);
    const wrong = correct === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const response = await inject(harness.app, {
        method: 'POST',
        url: '/api/reservations/verify',
        payload: { code: wrong, reservationId },
        cookie: provider.cookie,
      });
      expect(response.status).toBe(400);
      expect(response.body.error.details.attemptsRemaining).toBe(5 - attempt);
    }

    const fifth = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code: wrong, reservationId },
      cookie: provider.cookie,
    });
    expect(fifth.status).toBe(423);

    const stored = harness.db.get<{ code_attempts: number; locked_at: string | null }>(
      'SELECT code_attempts, locked_at FROM reservations WHERE id = ?',
      [reservationId],
    )!;
    expect(stored.code_attempts).toBe(5);
    expect(stored.locked_at).toBeTruthy();

    // Even the correct code is refused once locked.
    const correctAfterLock = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code: correct, reservationId },
      cookie: provider.cookie,
    });
    expect(correctAfterLock.status).toBe(423);
  });

  it('refuses verification before the pickup slot starts and after it ends', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 5,
      quantityRemaining: 5,
    });
    const reservationId = await reserve(listing.id);
    const code = getReservationCode(harness.db, harness.config, reservationId);

    setReservationWindow(
      harness.db,
      reservationId,
      new Date(Date.now() + 30 * 60_000),
      new Date(Date.now() + 90 * 60_000),
    );
    const tooEarly = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code, reservationId },
      cookie: provider.cookie,
    });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error.code).toBe('PICKUP_NOT_STARTED');

    const afterAttempt = harness.db.get<{ code_attempts: number }>(
      'SELECT code_attempts FROM reservations WHERE id = ?',
      [reservationId],
    )!;
    expect(afterAttempt.code_attempts).toBe(0); // a wrong-time attempt never burns an attempt

    setReservationWindow(
      harness.db,
      reservationId,
      new Date(Date.now() - 90 * 60_000),
      new Date(Date.now() - 30 * 60_000),
    );
    const tooLate = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code, reservationId },
      cookie: provider.cookie,
    });
    expect(tooLate.status).toBe(409);
    expect(tooLate.body.error.code).toBe('PICKUP_WINDOW_CLOSED');
  });

  it('returns 404 when a provider verifies a reservation on someone else’s listing', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 3,
      quantityRemaining: 3,
    });
    const reservationId = await reserve(listing.id);
    const code = getReservationCode(harness.db, harness.config, reservationId);
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${reservationId}/verify`,
      payload: { code },
      cookie: otherProvider.cookie,
    });
    expect(response.status).toBe(404);
  });

  it('rejects a cancellation from the provider after collection', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 3,
      quantityRemaining: 3,
    });
    const reservationId = await reserve(listing.id, 1);
    const code = getReservationCode(harness.db, harness.config, reservationId);
    await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${reservationId}/verify`,
      payload: { code },
      cookie: provider.cookie,
    });
    const cancel = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${reservationId}/cancel`,
      payload: { reason: 'too late' },
      cookie: provider.cookie,
    });
    expect(cancel.status).toBe(409);
  });

  it('counts only COLLECTED reservations in impact, with a meals estimate', async () => {
    harness.db.exec('DELETE FROM reservations;');

    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 100,
      quantityRemaining: 100,
    });

    // One collected (12 kg), one still reserved (5 kg), one cancelled (8 kg).
    const collected = await reserve(listing.id, 12);
    await reserve(listing.id, 5);
    const toCancel = await reserve(listing.id, 8);
    await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${toCancel}/cancel`,
      payload: { reason: 'changed mind' },
      cookie: recipient.cookie,
    });

    const code = getReservationCode(harness.db, harness.config, collected);
    const verified = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code },
      cookie: provider.cookie,
    });
    expect(verified.status).toBe(200);

    const impact = await inject(harness.app, { url: '/api/impact', cookie: provider.cookie });
    expect(impact.status).toBe(200);
    expect(impact.body.totals.pickups).toBe(1);
    expect(impact.body.totals.kg).toBe(12);
    expect(impact.body.totals.quantity).toBe(12);
    expect(impact.body.meals.estimate).toBeCloseTo(30, 5);
    expect(impact.body.meals.formula).toContain('0.4');
    expect(impact.body.meals.note).toContain('estimate');
    expect(impact.body.monthly).toHaveLength(6);
    expect(impact.body.monthly.at(-1).kg).toBe(12);
    expect(impact.body.recentPickups).toHaveLength(1);
    expect(impact.body.recentPickups[0].providerName).toBe('Verify Kitchen');

    const recipientImpact = await inject(harness.app, {
      url: '/api/impact',
      cookie: recipient.cookie,
    });
    expect(recipientImpact.body.scope).toBe('recipient');
    expect(recipientImpact.body.totals.pickups).toBe(1);

    const adminImpact = await inject(harness.app, { url: '/api/impact', cookie: admin.cookie });
    expect(adminImpact.body.scope).toBe('admin');
    expect(adminImpact.body.totals.pickups).toBe(1);

    const otherImpact = await inject(harness.app, {
      url: '/api/impact',
      cookie: otherProvider.cookie,
    });
    expect(otherImpact.body.totals.pickups).toBe(0);
  });

  it('uses the configurable meals factor', () => {
    expect(mealsEstimate(10, { ...harness.config, mealsKgPerMeal: 0.5 })).toBe(20);
    expect(mealsEstimate(10, harness.config)).toBe(25);
  });
});
