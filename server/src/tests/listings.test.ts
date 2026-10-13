import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { haversineKm } from '../lib/geo';
import { computeListingStatus, sweepStatuses } from '../services/listings';
import {
  createListingFixture,
  createTestHarness,
  createUser,
  inject,
  type TestHarness,
  type TestUser,
} from './helpers';

const HYDERABAD = { latitude: 17.385, longitude: 78.4867 };

describe('listing lifecycle, search, radius and expiry', () => {
  let harness: TestHarness;
  let provider: TestUser;
  let recipient: TestUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    provider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'provider@listings.test',
      organizationName: 'Listings Bakery',
      orgStatus: 'APPROVED',
      latitude: HYDERABAD.latitude,
      longitude: HYDERABAD.longitude,
    });
    recipient = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'recipient@listings.test',
      organizationName: 'Listings Food Bank',
      orgStatus: 'APPROVED',
      latitude: HYDERABAD.latitude,
      longitude: HYDERABAD.longitude,
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('creates a draft, publishes it, pauses it, resumes it and cancels it', async () => {
    const created = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: {
        title: 'Lifecycle listing',
        description: 'for lifecycle test',
        category: 'PRODUCE',
        quantity: 20,
        unit: 'kg',
        allergens: 'none',
        storage: 'CHILLED',
        pickupAddress: '10 Lifecycle Road, Hyderabad',
        latitude: 17.39,
        longitude: 78.49,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date(Date.now() + 4 * 3600_000).toISOString(),
        pickupInstructions: 'Ask for the manager',
      },
      cookie: provider.cookie,
    });
    expect(created.status).toBe(201);
    const id = created.body.listing.id;
    expect(created.body.listing.status).toBe('DRAFT');

    // Drafts never appear in public search.
    const publicSearch = await inject(harness.app, { url: '/api/listings' });
    expect(publicSearch.body.listings.some((l: { id: string }) => l.id === id)).toBe(false);

    const published = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${id}/status`,
      payload: { action: 'PUBLISH' },
      cookie: provider.cookie,
    });
    expect(published.status).toBe(200);
    expect(published.body.listing.status).toBe('ACTIVE');

    const nowVisible = await inject(harness.app, { url: '/api/listings?sort=ending_soon' });
    expect(nowVisible.body.listings.some((l: { id: string }) => l.id === id)).toBe(true);

    const paused = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${id}/status`,
      payload: { action: 'PAUSE' },
      cookie: provider.cookie,
    });
    expect(paused.body.listing.status).toBe('PAUSED');
    const hidden = await inject(harness.app, { url: '/api/listings' });
    expect(hidden.body.listings.some((l: { id: string }) => l.id === id)).toBe(false);

    const resumed = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${id}/status`,
      payload: { action: 'RESUME' },
      cookie: provider.cookie,
    });
    expect(resumed.body.listing.status).toBe('ACTIVE');

    const cancelled = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${id}/status`,
      payload: { action: 'CANCEL', reason: 'Kitchen closed early' },
      cookie: provider.cookie,
    });
    expect(cancelled.body.listing.status).toBe('CANCELLED');
  });

  it('computes EXPIRED on read and persists it with the sweep', () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      windowEnd: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() - 60_000),
      status: 'ACTIVE',
    });
    const row = harness.db.get<import('../db/types').ListingRow>(
      'SELECT * FROM listings WHERE id = ?',
      [listing.id],
    )!;
    expect(computeListingStatus(row)).toBe('EXPIRED');
    expect(computeListingStatus(row)).not.toBe(row.status); // still ACTIVE in the row
    const changed = sweepStatuses(harness.db);
    expect(changed).toBeGreaterThan(0);
    const swept = harness.db.get<{ status: string }>('SELECT status FROM listings WHERE id = ?', [
      listing.id,
    ])!;
    expect(swept.status).toBe('EXPIRED');
  });

  it('never returns expired listings from search', async () => {
    const expired = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Totally expired listing',
      windowStart: new Date(Date.now() - 4 * 3600_000),
      windowEnd: new Date(Date.now() - 2 * 3600_000),
      expiresAt: new Date(Date.now() - 2 * 3600_000),
      status: 'ACTIVE',
    });
    const response = await inject(harness.app, { url: '/api/listings' });
    expect(response.body.listings.some((l: { id: string }) => l.id === expired.id)).toBe(false);
    // The sweep also fixed the stored status.
    const row = harness.db.get<{ status: string }>('SELECT status FROM listings WHERE id = ?', [
      expired.id,
    ])!;
    expect(row.status).toBe('EXPIRED');
  });

  it('excludes listings outside the radius and sorts nearest first', async () => {
    // Clear existing listings so distances are unambiguous.
    harness.db.exec(`DELETE FROM listings;`);

    const near = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Near listing',
      latitude: 17.386,
      longitude: 78.487,
    });
    const mid = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Mid listing',
      latitude: 17.415,
      longitude: 78.505,
    });
    const far = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Far listing',
      latitude: 17.9,
      longitude: 79.5,
    });

    const within5 = await inject(harness.app, {
      url: `/api/listings?lat=${HYDERABAD.latitude}&lng=${HYDERABAD.longitude}&radius_km=5`,
    });
    const ids = within5.body.listings.map((l: { id: string }) => l.id);
    expect(ids).toEqual([near.id, mid.id]);
    expect(ids).not.toContain(far.id);

    const distances = within5.body.listings.map((l: { distanceKm: number }) => l.distanceKm);
    expect(distances[0]).toBeLessThan(distances[1]!);

    const expectedNear = haversineKm(HYDERABAD, { latitude: 17.386, longitude: 78.487 });
    expect(distances[0]).toBeCloseTo(expectedNear, 2);

    const within1 = await inject(harness.app, {
      url: `/api/listings?lat=${HYDERABAD.latitude}&lng=${HYDERABAD.longitude}&radius_km=1`,
    });
    expect(within1.body.listings.map((l: { id: string }) => l.id)).toEqual([near.id]);

    // Radius is capped at 50 km by the API contract.
    const capped = await inject(harness.app, {
      url: `/api/listings?lat=${HYDERABAD.latitude}&lng=${HYDERABAD.longitude}&radius_km=500`,
    });
    expect(capped.status).toBe(400);
  });

  it('filters by storage and sorts by ending soon', async () => {
    harness.db.exec('DELETE FROM listings;');
    const soon = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Ending soon hot meal',
      storage: 'HOT',
      windowEnd: new Date(Date.now() + 20 * 60_000),
      expiresAt: new Date(Date.now() + 20 * 60_000),
    });
    const later = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Later chilled box',
      storage: 'CHILLED',
      windowEnd: new Date(Date.now() + 5 * 3600_000),
      expiresAt: new Date(Date.now() + 5 * 3600_000),
    });

    const endingSoon = await inject(harness.app, { url: '/api/listings?sort=ending_soon' });
    expect(endingSoon.body.listings.map((l: { id: string }) => l.id)).toEqual([soon.id, later.id]);
    expect(endingSoon.body.listings[0].secondsLeft).toBeLessThan(
      endingSoon.body.listings[1].secondsLeft,
    );

    const hotOnly = await inject(harness.app, { url: '/api/listings?storage=HOT' });
    expect(hotOnly.body.listings.map((l: { id: string }) => l.id)).toEqual([soon.id]);
  });

  it('only exposes approximate coordinates publicly, exact address to the reservation holder', async () => {
    harness.db.exec('DELETE FROM listings;');
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      address: '99 Secret Street, Hyderabad',
      latitude: 17.391234,
      longitude: 78.486789,
    });

    const publicView = await inject(harness.app, { url: `/api/listings/${listing.id}` });
    expect(publicView.status).toBe(200);
    expect(publicView.body.listing.approximateLatitude).toBe(17.39);
    expect(publicView.body.listing.approximateLongitude).toBe(78.49);
    expect(publicView.body.listing.pickupAddress).toBeUndefined();
    expect(publicView.body.canReserve).toBe(false);
    expect(publicView.body.reservationBlockedReason).toContain('Sign in');

    const reserved = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });
    expect(reserved.status).toBe(201);
    const afterReserving = await inject(harness.app, {
      url: `/api/listings/${listing.id}`,
      cookie: recipient.cookie,
    });
    expect(afterReserving.body.listing.pickupAddress).toBe('99 Secret Street, Hyderabad');
    expect(afterReserving.body.myReservation.code).toMatch(/^\d{6}$/);

    const ownerView = await inject(harness.app, {
      url: `/api/provider/listings/${listing.id}`,
      cookie: provider.cookie,
    });
    expect(ownerView.body.listing.pickupAddress).toBe('99 Secret Street, Hyderabad');
  });

  it('returns only ACTIVE listings from approved providers', async () => {
    harness.db.exec('DELETE FROM listings;');
    createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      title: 'Approved provider listing',
    });
    const pendingProvider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'hidden@listings.test',
      organizationName: 'Unapproved kitchen',
      orgStatus: 'PENDING',
    });
    const hidden = createListingFixture(harness.db, {
      providerId: pendingProvider.organizationId!,
      title: 'Pending provider listing',
    });

    const response = await inject(harness.app, { url: '/api/listings' });
    const titles = response.body.listings.map((l: { title: string }) => l.title);
    expect(titles).toContain('Approved provider listing');
    expect(titles).not.toContain('Pending provider listing');
    expect(response.body.listings.some((l: { id: string }) => l.id === hidden.id)).toBe(false);
  });
});
