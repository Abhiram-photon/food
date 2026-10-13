import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createListingFixture,
  createTestHarness,
  createUser,
  inject,
  type TestHarness,
  type TestUser,
} from './helpers';

describe('role guards and organization approval', () => {
  let harness: TestHarness;
  let provider: TestUser;
  let otherProvider: TestUser;
  let recipient: TestUser;
  let pendingRecipient: TestUser;
  let pendingProvider: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    const { db } = harness;
    provider = await createUser(db, {
      role: 'PROVIDER',
      email: 'provider@test.dev',
      organizationName: 'Approved Bakery',
      organizationType: 'BAKERY',
      orgStatus: 'APPROVED',
      latitude: 17.385,
      longitude: 78.4867,
    });
    otherProvider = await createUser(db, {
      role: 'PROVIDER',
      email: 'other-provider@test.dev',
      organizationName: 'Other Bakery',
      organizationType: 'GROCERY',
      orgStatus: 'APPROVED',
      latitude: 17.4,
      longitude: 78.45,
    });
    recipient = await createUser(db, {
      role: 'RECIPIENT',
      email: 'recipient@test.dev',
      organizationName: 'Approved Food Bank',
      organizationType: 'FOOD_BANK',
      orgStatus: 'APPROVED',
      latitude: 17.39,
      longitude: 78.48,
    });
    pendingRecipient = await createUser(db, {
      role: 'RECIPIENT',
      email: 'pending-recipient@test.dev',
      organizationName: 'Pending Charity',
      organizationType: 'CHARITY',
      orgStatus: 'PENDING',
      latitude: 17.39,
      longitude: 78.48,
    });
    pendingProvider = await createUser(db, {
      role: 'PROVIDER',
      email: 'pending-provider@test.dev',
      organizationName: 'Pending Caterer',
      organizationType: 'CATERER',
      orgStatus: 'PENDING',
      latitude: 17.39,
      longitude: 78.48,
    });
    admin = await createUser(db, { role: 'ADMIN', email: 'admin@test.dev', orgStatus: null });
  });

  afterAll(async () => {
    await harness.close();
  });

  const listingPayload = {
    title: 'Guard test listing',
    description: 'created by tests',
    category: 'BAKERY',
    quantity: 10,
    unit: 'kg',
    allergens: 'gluten',
    storage: 'AMBIENT',
    pickupAddress: '2 Test Street, Hyderabad',
    latitude: 17.385,
    longitude: 78.4867,
    windowStart: new Date(Date.now() - 60_000).toISOString(),
    windowEnd: new Date(Date.now() + 3 * 3600_000).toISOString(),
  };

  it('lets an approved provider create a listing', async () => {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: listingPayload,
      cookie: provider.cookie,
      csrfToken: provider.csrfToken,
    });
    expect(response.status).toBe(201);
    expect(response.body.listing.status).toBe('DRAFT');
  });

  it('blocks a recipient from creating a listing', async () => {
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: listingPayload,
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WRONG_ROLE');
  });

  it('blocks a provider from reserving', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: provider.cookie,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WRONG_ROLE');
  });

  it('returns 404 when a provider edits someone else’s listing', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const patch = await inject(harness.app, {
      method: 'PATCH',
      url: `/api/listings/${listing.id}`,
      payload: { title: 'Hijacked listing' },
      cookie: otherProvider.cookie,
    });
    expect(patch.status).toBe(404);

    const status = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/status`,
      payload: { action: 'PUBLISH' },
      cookie: otherProvider.cookie,
    });
    expect(status.status).toBe(404);
  });

  it('returns 404 when a recipient cancels someone else’s reservation', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 2 },
      cookie: recipient.cookie,
    });
    expect(created.status).toBe(201);
    const reservationId = created.body.reservation.id;

    const intruder = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'intruder@test.dev',
      organizationName: 'Intruder Nonprofit',
      orgStatus: 'APPROVED',
    });
    const cancel = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${reservationId}/cancel`,
      payload: {},
      cookie: intruder.cookie,
    });
    expect(cancel.status).toBe(404);

    const read = await inject(harness.app, {
      url: `/api/reservations/${reservationId}`,
      cookie: intruder.cookie,
    });
    expect(read.status).toBe(404);
  });

  it('hides another provider’s private (draft) listing behind a 404', async () => {
    const draft = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      status: 'DRAFT',
    });
    const asOther = await inject(harness.app, { url: `/api/listings/${draft.id}` });
    expect(asOther.status).toBe(404);
    const asOwner = await inject(harness.app, {
      url: `/api/listings/${draft.id}`,
      cookie: provider.cookie,
    });
    expect(asOwner.status).toBe(200);
    const asAdmin = await inject(harness.app, {
      url: `/api/listings/${draft.id}`,
      cookie: admin.cookie,
    });
    expect(asAdmin.status).toBe(200);
  });

  it('blocks a pending recipient from reserving', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const response = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: pendingRecipient.cookie,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ORG_PENDING');
  });

  it('lets a pending provider save a draft but not publish', async () => {
    const create = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: listingPayload,
      cookie: pendingProvider.cookie,
    });
    expect(create.status).toBe(201);
    expect(create.body.listing.status).toBe('DRAFT');

    const publish = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${create.body.listing.id}/status`,
      payload: { action: 'PUBLISH' },
      cookie: pendingProvider.cookie,
    });
    expect(publish.status).toBe(409);
    expect(publish.body.error.code).toBe('ORG_NOT_APPROVED');
  });

  it('refuses verification from non-providers', async () => {
    const listing = createListingFixture(harness.db, { providerId: provider.organizationId! });
    const response = await inject(harness.app, {
      method: 'POST',
      url: '/api/reservations/verify',
      payload: { code: '123456' },
      cookie: recipient.cookie,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('WRONG_ROLE');
  });

  it('keeps admin endpoints admin-only', async () => {
    const asProvider = await inject(harness.app, {
      url: '/api/admin/organizations',
      cookie: provider.cookie,
    });
    expect(asProvider.status).toBe(403);
    const asAdmin = await inject(harness.app, {
      url: '/api/admin/organizations',
      cookie: admin.cookie,
    });
    expect(asAdmin.status).toBe(200);
  });
});
