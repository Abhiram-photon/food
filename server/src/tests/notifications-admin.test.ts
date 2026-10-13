import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createListingFixture,
  createTestHarness,
  createUser,
  inject,
  type TestHarness,
  type TestUser,
} from './helpers';

describe('notifications and admin console', () => {
  let harness: TestHarness;
  let admin: TestUser;
  let provider: TestUser;
  let pendingProvider: TestUser;
  let recipient: TestUser;

  beforeAll(async () => {
    harness = await createTestHarness();
    admin = await createUser(harness.db, {
      role: 'ADMIN',
      email: 'admin@admin.test',
      orgStatus: null,
    });
    provider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'provider@admin.test',
      organizationName: 'Admin Test Bakery',
      orgStatus: 'APPROVED',
    });
    pendingProvider = await createUser(harness.db, {
      role: 'PROVIDER',
      email: 'pending@admin.test',
      organizationName: 'Pending Caterer',
      orgStatus: 'PENDING',
    });
    recipient = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'recipient@admin.test',
      organizationName: 'Admin Test Food Bank',
      orgStatus: 'APPROVED',
    });
  });

  afterAll(async () => {
    await harness.close();
  });

  it('lists pending organizations for admins and approves one with a note', async () => {
    const pending = await inject(harness.app, {
      url: '/api/admin/organizations?status=PENDING',
      cookie: admin.cookie,
    });
    expect(pending.status).toBe(200);
    expect(pending.body.organizations.map((o: { id: string }) => o.id)).toContain(
      pendingProvider.organizationId,
    );

    const review = await inject(harness.app, {
      method: 'POST',
      url: `/api/admin/organizations/${pendingProvider.organizationId}/review`,
      payload: { decision: 'APPROVE', note: 'Food safety docs verified' },
      cookie: admin.cookie,
    });
    expect(review.status).toBe(200);
    expect(review.body.organization.status).toBe('APPROVED');
    expect(review.body.organization.reviewNote).toBe('Food safety docs verified');

    // The newly approved provider can now publish.
    const publish = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: {
        title: 'Post-approval listing',
        description: 'created after admin approval',
        category: 'CATERER',
        quantity: 10,
        unit: 'kg',
        storage: 'CHILLED',
        pickupAddress: '3 Approval Road, Hyderabad',
        latitude: 17.4,
        longitude: 78.5,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date(Date.now() + 3600_000).toISOString(),
      },
      cookie: pendingProvider.cookie,
    });
    // category CATERER is not a listing category; the API validates it.
    expect(publish.status).toBe(400);

    const publishOk = await inject(harness.app, {
      method: 'POST',
      url: '/api/listings',
      payload: {
        title: 'Post-approval listing',
        description: 'created after admin approval',
        category: 'PREPARED_MEALS',
        quantity: 10,
        unit: 'kg',
        storage: 'CHILLED',
        pickupAddress: '3 Approval Road, Hyderabad',
        latitude: 17.4,
        longitude: 78.5,
        windowStart: new Date(Date.now() - 60_000).toISOString(),
        windowEnd: new Date(Date.now() + 3600_000).toISOString(),
      },
      cookie: pendingProvider.cookie,
    });
    expect(publishOk.status).toBe(201);
    const status = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${publishOk.body.listing.id}/status`,
      payload: { action: 'PUBLISH' },
      cookie: pendingProvider.cookie,
    });
    expect(status.body.listing.status).toBe('ACTIVE');
  });

  it('rejects an organization with a note and notifies its users', async () => {
    const rejected = await createUser(harness.db, {
      role: 'RECIPIENT',
      email: 'reject-me@admin.test',
      organizationName: 'Rejected Charity',
      orgStatus: 'PENDING',
    });
    const review = await inject(harness.app, {
      method: 'POST',
      url: `/api/admin/organizations/${rejected.organizationId}/review`,
      payload: { decision: 'REJECT', note: 'Incomplete registration documents' },
      cookie: admin.cookie,
    });
    expect(review.status).toBe(200);
    expect(review.body.organization.status).toBe('REJECTED');

    const notifications = await inject(harness.app, {
      url: '/api/notifications',
      cookie: rejected.cookie,
    });
    const rejection = notifications.body.notifications.find(
      (n: { type: string }) => n.type === 'ORG_REJECTED',
    );
    expect(rejection).toBeDefined();
    expect(rejection.body).toContain('Incomplete registration documents');
  });

  it('tracks unread notifications and marks them read', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 4,
      quantityRemaining: 4,
    });
    await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });

    const before = await inject(harness.app, {
      url: '/api/notifications',
      cookie: provider.cookie,
    });
    expect(before.body.unreadCount).toBeGreaterThan(0);
    expect(before.body.notifications[0].readAt).toBeNull();

    const read = await inject(harness.app, {
      method: 'POST',
      url: '/api/notifications/read',
      payload: { all: true },
      cookie: provider.cookie,
    });
    expect(read.status).toBe(200);
    expect(read.body.unreadCount).toBe(0);

    const after = await inject(harness.app, { url: '/api/notifications', cookie: provider.cookie });
    expect(after.body.unreadCount).toBe(0);
    expect(
      after.body.notifications.every((n: { readAt: string | null }) => n.readAt !== null),
    ).toBe(true);

    // Marking read is scoped to the session user.
    const otherUnread = await inject(harness.app, {
      url: '/api/notifications',
      cookie: recipient.cookie,
    });
    expect(otherUnread.status).toBe(200);
  });

  it('notifies both sides when a pickup is verified', async () => {
    const listing = createListingFixture(harness.db, {
      providerId: provider.organizationId!,
      quantity: 2,
      quantityRemaining: 2,
    });
    const created = await inject(harness.app, {
      method: 'POST',
      url: `/api/listings/${listing.id}/reservations`,
      payload: { quantity: 1 },
      cookie: recipient.cookie,
    });
    const code = created.body.pickupCode;
    const verify = await inject(harness.app, {
      method: 'POST',
      url: `/api/reservations/${created.body.reservation.id}/verify`,
      payload: { code },
      cookie: provider.cookie,
    });
    expect(verify.status).toBe(200);

    for (const user of [provider, recipient]) {
      const notifications = await inject(harness.app, {
        url: '/api/notifications',
        cookie: user.cookie,
      });
      expect(
        notifications.body.notifications.some(
          (n: { type: string }) => n.type === 'PICKUP_VERIFIED',
        ),
      ).toBe(true);
    }
  });

  it('reports platform totals to admins only', async () => {
    const totals = await inject(harness.app, { url: '/api/admin/totals', cookie: admin.cookie });
    expect(totals.status).toBe(200);
    expect(totals.body.organizations.total).toBeGreaterThan(0);
    expect(totals.body.listings.total).toBeGreaterThan(0);
    expect(totals.body.reservations.collected).toBeGreaterThan(0);
    expect(totals.body.impact.kgPerMeal).toBe(0.4);
    expect(totals.body.monthly).toHaveLength(6);

    const forbidden = await inject(harness.app, {
      url: '/api/admin/totals',
      cookie: recipient.cookie,
    });
    expect(forbidden.status).toBe(403);
  });

  it('exposes a public impact summary for the landing page', async () => {
    const response = await inject(harness.app, { url: '/api/impact/public' });
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('pickups');
    expect(response.body).toHaveProperty('mealsEstimate');
  });
});
