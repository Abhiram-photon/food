import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CountdownBadge } from '../components/CountdownBadge';
import { ListingCard } from '../components/ListingCard';
import { BarChart } from '../components/BarChart';
import { EmptyState, StatusBadge } from '../components/ui';
import { formatCountdown, formatDistance, formatQuantity, humanizeEnum } from '../lib/format';
import type { PublicListing } from '@shared';

function makeListing(overrides: Partial<PublicListing> = {}): PublicListing {
  return {
    id: 'listing-1',
    title: 'Surplus bakery bread',
    description: 'Fresh loaves from this morning',
    category: 'BAKERY',
    quantity: 40,
    quantityRemaining: 28,
    unit: 'loaves',
    allergens: ['gluten'],
    storage: 'AMBIENT',
    status: 'ACTIVE',
    approximateLatitude: 17.39,
    approximateLongitude: 78.49,
    windowStart: new Date(Date.now() - 600_000).toISOString(),
    windowEnd: new Date(Date.now() + 7_200_000).toISOString(),
    expiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    secondsLeft: 7200,
    distanceKm: 2.4,
    provider: { id: 'org-1', name: 'Hyderabad Bakery Collective', type: 'BAKERY' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('formatting helpers', () => {
  it('formats countdowns at different scales', () => {
    expect(formatCountdown(0)).toBe('ended');
    expect(formatCountdown(45)).toBe('45s left');
    expect(formatCountdown(180)).toBe('3m left');
    expect(formatCountdown(3700)).toBe('1h 1m left');
    expect(formatCountdown(90_000)).toBe('1d 1h left');
  });

  it('formats quantities and distances', () => {
    expect(formatQuantity(3)).toBe('3');
    expect(formatQuantity(2.5)).toBe('2.5');
    expect(formatDistance(0.4)).toBe('400 m away');
    expect(formatDistance(2.44)).toBe('2.4 km away');
    expect(formatDistance(null)).toBe('');
    expect(humanizeEnum('PREPARED_MEALS')).toBe('Prepared Meals');
  });
});

describe('CountdownBadge', () => {
  it('renders the remaining time and switches to an urgent tone under an hour', () => {
    const soon = new Date(Date.now() + 30 * 60_000).toISOString();
    render(<CountdownBadge expiresAt={soon} secondsLeft={1800} />);
    expect(screen.getByText('30m left')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-badge')).toHaveAttribute('data-tone', 'urgent');
  });

  it('shows the calm tone when there is plenty of time', () => {
    const later = new Date(Date.now() + 6 * 3600_000).toISOString();
    render(<CountdownBadge expiresAt={later} secondsLeft={21_600} />);
    expect(screen.getByText('6h 0m left')).toBeInTheDocument();
    expect(screen.getByTestId('countdown-badge')).toHaveAttribute('data-tone', 'calm');
  });
});

describe('ListingCard', () => {
  it('shows listing details, distance and the reserve call to action', () => {
    render(
      <MemoryRouter>
        <ListingCard listing={makeListing()} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Surplus bakery bread')).toBeInTheDocument();
    expect(screen.getByText(/28 \/ 40/)).toBeInTheDocument();
    expect(screen.getByText('2.4 km away')).toBeInTheDocument();
    expect(screen.getByText(/Contains: gluten/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reserve' })).toHaveAttribute(
      'href',
      '/listings/listing-1',
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('switches the CTA when the listing is fully reserved', () => {
    render(
      <MemoryRouter>
        <ListingCard
          listing={makeListing({ status: 'RESERVED_OUT', quantityRemaining: 0, secondsLeft: 60 })}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Reserved Out')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View details' })).toBeInTheDocument();
  });

  it('notifies the parent when hovered (map highlighting)', () => {
    const onFocus = vi.fn();
    render(
      <MemoryRouter>
        <ListingCard listing={makeListing()} onFocus={onFocus} />
      </MemoryRouter>,
    );
    fireEvent.mouseEnter(screen.getByTestId('listing-card'));
    expect(onFocus).toHaveBeenCalledTimes(1);
  });
});

describe('BarChart', () => {
  it('renders one labelled bar per month', () => {
    render(
      <BarChart
        title="Rescued kg per month"
        data={[
          { month: '2026-08', value: 12 },
          { month: '2026-09', value: 30 },
          { month: '2026-10', value: 0 },
        ]}
        unit="kg"
      />,
    );
    expect(screen.getByText('Rescued kg per month')).toBeInTheDocument();
    expect(screen.getByLabelText('Aug 26: 12 kg')).toBeInTheDocument();
    expect(screen.getByLabelText('Sep 26: 30 kg')).toBeInTheDocument();
    expect(screen.getAllByText('12 kg').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30 kg').length).toBeGreaterThan(0);
  });

  it('shows the empty message when every value is zero', () => {
    render(
      <BarChart
        title="Rescued kg per month"
        data={[{ month: '2026-10', value: 0 }]}
        emptyMessage="Nothing yet"
      />,
    );
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByTestId('bar-chart')).not.toBeInTheDocument();
  });
});

describe('shared UI states', () => {
  it('renders status badges with humanised labels', () => {
    render(<StatusBadge status="RESERVED_OUT" />);
    expect(screen.getByText('Reserved Out')).toBeInTheDocument();
  });

  it('renders an empty state with its description', () => {
    render(<EmptyState title="No listings" description="Nothing within 5 km" />);
    expect(screen.getByText('No listings')).toBeInTheDocument();
    expect(screen.getByText('Nothing within 5 km')).toBeInTheDocument();
  });
});
