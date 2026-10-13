import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../state/AuthContext';
import { LoginPage } from '../pages/LoginPage';
import { ListingDetailPage } from '../pages/ListingDetailPage';
import { ImpactPage } from '../pages/ImpactPage';
import type { ListingDetailResponse } from '@shared';

/** Mounts a page on its real route so useParams/useSearchParams behave like in the app. */
function renderOnRoute(path: string, routePath: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const body = handler(url, init);
    return new Response(JSON.stringify(body ?? {}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LoginPage', () => {
  it('labels its inputs and shows a server error message on failure', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/auth/me')) {
          return new Response(JSON.stringify({ user: null, csrfToken: null, capabilities: null }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({ error: { code: 'UNAUTHENTICATED', message: 'Email or password is incorrect.' } }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        );
      }),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Password/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Email/), 'nobody@example.com');
    await user.type(screen.getByLabelText(/^Password/), 'wrongpass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
  });

  it('fills the demo credentials from the demo shortcuts', async () => {
    const user = userEvent.setup();
    mockFetch((url) => (url.includes('/api/auth/me') ? { user: null } : {}));

    render(
      <MemoryRouter>
        <AuthProvider>
          <LoginPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /Provider: bakery@freshrelay.dev/ }));
    expect(screen.getByLabelText(/^Email/)).toHaveValue('bakery@freshrelay.dev');
    expect(screen.getByLabelText(/^Password/)).toHaveValue('Password123!');
  });
});

describe('ListingDetailPage', () => {
  const detail: ListingDetailResponse = {
    listing: {
      id: 'listing-1',
      title: 'Surplus bakery bread — 40 loaves',
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
    },
    reservationBlockedReason: 'Sign in as an approved recipient organization to reserve.',
    canReserve: false,
    isOwner: false,
    myReservation: null,
  };

  it('disables the reserve form and explains why when reservation is not allowed', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) return { user: null };
      if (url.includes('/api/listings/listing-1')) return detail;
      return {};
    });

    renderOnRoute('/listings/listing-1', '/listings/:id', <ListingDetailPage />);

    expect(await screen.findByRole('heading', { name: detail.listing.title })).toBeInTheDocument();
    expect(screen.getByText(detail.reservationBlockedReason!)).toBeInTheDocument();
    expect(screen.getByLabelText(/Quantity/)).toBeDisabled();
    expect(screen.getByRole('button', { name: /Reservation unavailable/ })).toBeDisabled();
    expect(screen.getByText(/Hidden until you hold a reservation/)).toBeInTheDocument();
    expect(screen.getByText(/gluten/)).toBeInTheDocument();
  });

  it('shows the exact address and pickup code once a reservation exists', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) return { user: null };
      if (url.includes('/api/listings/listing-1')) {
        return {
          ...detail,
          listing: { ...detail.listing, pickupAddress: '12-2-417, Mehdipatnam Main Road, Hyderabad' },
          reservationBlockedReason: 'This listing is fully reserved — check back, stock may return.',
          canReserve: false,
          myReservation: {
            id: 'res-1',
            code: '482913',
            quantity: 12,
            status: 'RESERVED',
            pickupStart: new Date().toISOString(),
            pickupEnd: new Date(Date.now() + 3600_000).toISOString(),
          },
        };
      }
      return {};
    });

    renderOnRoute('/listings/listing-1', '/listings/:id', <ListingDetailPage />);

    expect(await screen.findByText('You already reserved this listing')).toBeInTheDocument();
    expect(screen.getByText('482913')).toBeInTheDocument();
    expect(screen.getByText('12-2-417, Mehdipatnam Main Road, Hyderabad')).toBeInTheDocument();
  });
});

describe('ImpactPage', () => {
  it('renders role-scoped totals, the meals formula and the monthly chart', async () => {
    mockFetch((url) => {
      if (url.includes('/api/auth/me')) return { user: null };
      if (url.includes('/api/impact')) {
        return {
          scope: 'provider',
          totals: {
            pickups: 7,
            quantity: 96,
            kg: 96,
            unitFreeQuantity: 0,
            listings: 4,
            activeListings: 2,
            reservedListings: 1,
            pendingReservations: 3,
          },
          meals: {
            estimate: 240,
            kgPerMeal: 0.4,
            formula: 'meals = rescued kg ÷ 0.4',
            note: 'Meals are estimated using the assumption that one meal weighs about 0.4 kg (meals = rescued kg / 0.4). This is an estimate, not a measured figure.',
          },
          monthly: [
            { month: '2026-08', pickups: 2, quantity: 20, kg: 20, meals: 50 },
            { month: '2026-09', pickups: 3, quantity: 46, kg: 46, meals: 115 },
            { month: '2026-10', pickups: 2, quantity: 30, kg: 30, meals: 75 },
          ],
          byStorage: [{ key: 'AMBIENT', label: 'AMBIENT', pickups: 4, quantity: 50, kg: 50 }],
          byCategory: [{ key: 'BAKERY', label: 'BAKERY', pickups: 6, quantity: 80, kg: 80 }],
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
        };
      }
      return {};
    });

    render(
      <MemoryRouter>
        <AuthProvider>
          <ImpactPage />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText('Your organization’s impact')).toBeInTheDocument());
    expect(screen.getByText('96 kg')).toBeInTheDocument();
    expect(screen.getByText(/Meals are estimated using the assumption/)).toBeInTheDocument();
    expect(screen.getByLabelText('Sep 26: 46 kg')).toBeInTheDocument();
    expect(screen.getByText('Surplus bakery bread')).toBeInTheDocument();
  });
});
