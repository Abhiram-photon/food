/**
 * Route-level smoke test: mounts the whole app on each route with a stubbed API and
 * asserts the page actually renders its content (a substitute for manual clicking,
 * because Playwright browsers cannot be downloaded in this environment).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App } from '../App';
import { AuthProvider } from '../state/AuthContext';

// Leaflet needs real layout/geometry; the map itself is a thin wrapper we verify manually.
vi.mock('../components/MapView', () => ({
  MapView: ({ listings }: { listings: unknown[] }) => (
    <div data-testid="map-stub">map with {listings.length} markers</div>
  ),
}));

const providerUser = {
  id: 'u-1',
  email: 'bakery@freshrelay.dev',
  displayName: 'Imran Khan',
  role: 'PROVIDER',
  organizationId: 'org-1',
  organizationName: 'Hyderabad Bakery Collective',
  organizationStatus: 'APPROVED',
  organizationType: 'BAKERY',
  createdAt: new Date().toISOString(),
};

function listing(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    title: 'Surplus bakery bread',
    description: 'Fresh loaves',
    category: 'BAKERY',
    quantity: 40,
    quantityRemaining: 28,
    unit: 'loaves',
    allergens: ['gluten'],
    storage: 'AMBIENT',
    status: 'ACTIVE',
    approximateLatitude: 17.4,
    approximateLongitude: 78.44,
    windowStart: new Date(Date.now() - 600_000).toISOString(),
    windowEnd: new Date(Date.now() + 7_200_000).toISOString(),
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    secondsLeft: 7200,
    distanceKm: 3.1,
    provider: { id: 'org-1', name: 'Hyderabad Bakery Collective', type: 'BAKERY' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function stubApi(role: 'PROVIDER' | 'RECIPIENT' | 'ADMIN' | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

      if (url.includes('/api/auth/me')) {
        if (!role) return json({ user: null, csrfToken: null, capabilities: null });
        const user =
          role === 'PROVIDER'
            ? providerUser
            : {
                ...providerUser,
                id: 'u-2',
                role,
                organizationName: role === 'ADMIN' ? null : 'Sneha Shelter Trust',
                organizationType: role === 'ADMIN' ? null : 'SHELTER',
              };
        return json({
          user,
          csrfToken: 'csrf-1',
          capabilities: {
            canPublishListing: role === 'PROVIDER',
            canReserve: role === 'RECIPIENT',
            canVerifyPickup: role === 'PROVIDER',
            canModerateOrganizations: role === 'ADMIN',
            blockedReason: null,
          },
        });
      }
      if (url.includes('/api/impact/public')) {
        return json({
          pickups: 12,
          kg: 340,
          mealsEstimate: 850,
          kgPerMeal: 0.4,
          approvedProviders: 3,
          approvedRecipients: 4,
          activeListings: 6,
        });
      }
      if (url.includes('/api/impact')) {
        return json({
          scope: 'provider',
          totals: {
            pickups: 3,
            quantity: 64,
            kg: 64,
            unitFreeQuantity: 0,
            listings: 2,
            activeListings: 1,
            reservedListings: 0,
            pendingReservations: 1,
          },
          meals: {
            estimate: 160,
            kgPerMeal: 0.4,
            formula: 'meals = rescued kg ÷ 0.4',
            note: 'Meals are estimated using the assumption that one meal weighs about 0.4 kg.',
          },
          monthly: [{ month: '2026-10', pickups: 3, quantity: 64, kg: 64, meals: 160 }],
          byStorage: [{ key: 'AMBIENT', label: 'AMBIENT', pickups: 3, quantity: 64, kg: 64 }],
          byCategory: [{ key: 'BAKERY', label: 'BAKERY', pickups: 3, quantity: 64, kg: 64 }],
          recentPickups: [
            {
              id: 'res-1',
              listingTitle: 'Surplus bakery bread',
              quantity: 12,
              unit: 'loaves',
              collectedAt: new Date().toISOString(),
              providerName: 'Hyderabad Bakery Collective',
              recipientName: 'Sneha Shelter Trust',
            },
          ],
        });
      }
      if (url.includes('/api/listings?')) {
        return json({
          listings: [listing()],
          count: 1,
          center: { latitude: 17.385, longitude: 78.4867 },
          radiusKm: 5,
          sort: 'nearest',
          availableStorage: ['AMBIENT'],
          availableCategories: ['BAKERY'],
        });
      }
      if (/\/api\/listings\/[^/?]+$/.test(url)) {
        return json({
          listing: listing({ pickupAddress: '12-2-417 Mehdipatnam, Hyderabad' }),
          reservationBlockedReason: 'Sign in as an approved recipient organization to reserve.',
          canReserve: false,
          isOwner: false,
          myReservation: null,
        });
      }
      if (url.includes('/api/provider/listings')) return json({ listings: [listing()] });
      if (url.includes('/api/provider/reservations') || url.includes('/api/reservations')) {
        return json({
          count: 1,
          reservations: [
            {
              id: 'res-1',
              listingId: 'listing-1',
              listingTitle: 'Surplus bakery bread',
              listingUnit: 'loaves',
              listingCategory: 'BAKERY',
              listingStorage: 'AMBIENT',
              status: 'RESERVED',
              quantity: 12,
              unit: 'loaves',
              pickupStart: new Date().toISOString(),
              pickupEnd: new Date(Date.now() + 3600_000).toISOString(),
              windowEnd: new Date(Date.now() + 3600_000).toISOString(),
              createdAt: new Date().toISOString(),
              collectedAt: null,
              cancelledAt: null,
              cancelReason: null,
              cancelledBy: null,
              codeAttempts: 0,
              locked: false,
              code: '482913',
              codeRevealed: true,
              provider: { id: 'org-1', name: 'Hyderabad Bakery Collective' },
              recipient: { id: 'org-2', name: 'Sneha Shelter Trust' },
              pickupAddress: '12-2-417 Mehdipatnam, Hyderabad',
              pickupInstructions: 'Ask for Imran',
            },
          ],
        });
      }
      if (url.includes('/api/notifications')) {
        return json({
          unreadCount: 1,
          notifications: [
            {
              id: 'n-1',
              type: 'RESERVATION_CREATED',
              title: 'New reservation',
              body: 'Sneha Shelter Trust reserved 12 loaves.',
              link: '/provider',
              entityId: 'res-1',
              readAt: null,
              createdAt: new Date().toISOString(),
            },
          ],
        });
      }
      if (url.includes('/api/admin/organizations')) {
        return json({
          count: 1,
          organizations: [
            {
              id: 'org-9',
              name: 'Pending Caterer',
              type: 'CATERER',
              role: 'PROVIDER',
              status: 'PENDING',
              contactEmail: 'caterer@freshrelay.dev',
              phone: null,
              address: 'Gachibowli, Hyderabad',
              latitude: 17.44,
              longitude: 78.34,
              reviewNote: null,
              reviewedAt: null,
              createdAt: new Date().toISOString(),
              userCount: 1,
              listingCount: 2,
              reservationCount: 0,
            },
          ],
        });
      }
      if (url.includes('/api/admin/totals')) {
        return json({
          organizations: { total: 6, pending: 2, approved: 4, rejected: 0 },
          listings: { total: 18, active: 6, reservedOut: 1, expired: 2, draft: 1 },
          reservations: { total: 10, reserved: 3, collected: 6, cancelled: 1 },
          impact: { pickups: 6, quantity: 258, kg: 258, mealsEstimate: 645, kgPerMeal: 0.4 },
          monthly: [{ month: '2026-10', pickups: 2, kg: 58 }],
        });
      }
      if (url.includes('/api/config') || url.includes('/api/facts')) return json({});
      return json({});
    }),
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe('route smoke tests', () => {
  it('renders the landing page with the UNEP citation and CTAs', async () => {
    stubApi(null);
    renderAt('/');
    expect(
      await screen.findByRole('heading', { name: /Good food should feed people, not bins/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1\.05 billion tonnes of food were wasted in 2022/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /List surplus food/ })).toBeInTheDocument();
    expect(await screen.findByText('340 kg')).toBeInTheDocument();
  });

  it('renders the register page with role selection', async () => {
    stubApi(null);
    renderAt('/register');
    expect(
      await screen.findByRole('heading', { name: /Register your organization/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Organization name/)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /I am registering as/ })).toBeInTheDocument();
  });

  it('renders the browse page with filters, countdown and the map slot', async () => {
    stubApi(null);
    renderAt('/browse');
    expect(await screen.findByText('Surplus bakery bread')).toBeInTheDocument();
    expect(screen.getByTestId('map-stub')).toBeInTheDocument();
    expect(screen.getByLabelText('Radius (km)')).toBeInTheDocument();
    expect(screen.getByLabelText('Sort by')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-badge')).toBeInTheDocument();
  });

  it('renders the listing detail page', async () => {
    stubApi(null);
    renderAt('/listings/listing-1');
    expect(
      await screen.findByRole('heading', { name: 'Surplus bakery bread' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reservation unavailable/ })).toBeDisabled();
  });

  it('renders the provider workspace for a provider', async () => {
    stubApi('PROVIDER');
    renderAt('/provider');
    expect(await screen.findByRole('heading', { name: 'Provider workspace' })).toBeInTheDocument();
    expect((await screen.findAllByText('Surplus bakery bread')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Pickup code/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify pickup' })).toBeInTheDocument();
  });

  it('renders the recipient reservations page with codes', async () => {
    stubApi('RECIPIENT');
    renderAt('/recipient');
    expect(await screen.findByRole('heading', { name: 'My reservations' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Reveal code' })).toBeInTheDocument();
    expect(screen.getByText('••••••')).toBeInTheDocument();
  });

  it('renders the impact page with the meals formula', async () => {
    stubApi('PROVIDER');
    renderAt('/impact');
    expect(await screen.findByRole('heading', { name: /impact/i })).toBeInTheDocument();
    expect(screen.getByText(/one meal weighs about 0.4 kg/)).toBeInTheDocument();
  });

  it('renders the admin console with pending organizations', async () => {
    stubApi('ADMIN');
    renderAt('/admin');
    expect(await screen.findByRole('heading', { name: 'Admin console' })).toBeInTheDocument();
    expect(await screen.findByText('Pending Caterer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  });

  it('redirects unauthenticated visitors away from protected pages', async () => {
    stubApi(null);
    renderAt('/provider');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('shows the app shell (header + notification bell) for signed-in users', async () => {
    stubApi('PROVIDER');
    renderAt('/provider');
    await waitFor(() => expect(screen.getByLabelText(/Notifications/)).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'FreshRelay' })).toBeInTheDocument();
  });

  it('renders a 404 page for unknown routes', async () => {
    stubApi(null);
    renderAt('/definitely-not-a-page');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });
});
