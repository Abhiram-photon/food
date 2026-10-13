import { Link } from 'react-router-dom';
import { useApiQuery } from '../api/hooks';
import { BarChart } from '../components/BarChart';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatCard } from '../components/ui';
import { formatDateTime, formatQuantity, humanizeEnum } from '../lib/format';
import type { ImpactStats } from '@shared';

const SCOPE_COPY: Record<string, { title: string; subtitle: string }> = {
  platform: {
    title: 'Platform impact',
    subtitle: 'Every verified pickup across FreshRelay.',
  },
  admin: {
    title: 'Platform impact',
    subtitle: 'Every verified pickup across FreshRelay — admin view.',
  },
  provider: {
    title: 'Your organization’s impact',
    subtitle: 'Only pickups that were verified with a code on your listings.',
  },
  recipient: {
    title: 'Your rescue impact',
    subtitle: 'Only pickups your organization completed and verified.',
  },
};

export function ImpactPage() {
  const { data, loading, error, reload } = useApiQuery<ImpactStats>('/impact');

  if (loading) return <LoadingState label="Crunching rescued kilograms…" />;
  if (error) return <ErrorState message={error} onRetry={reload} title="Could not load impact" />;
  if (!data) return <ErrorState message="No impact data available." title="No data" />;

  const copy = SCOPE_COPY[data.scope] ?? SCOPE_COPY.platform!;

  return (
    <div>
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={
          <Link to="/browse" className="fr-btn-secondary">
            Browse listings
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Verified pickups"
          value={data.totals.pickups}
          hint="Collected reservations only"
        />
        <StatCard
          label="Food rescued"
          value={`${formatQuantity(data.totals.kg)} kg`}
          hint={
            data.totals.unitFreeQuantity > 0
              ? `Plus ${formatQuantity(data.totals.unitFreeQuantity)} in non-kg units`
              : 'All quantities recorded in kg'
          }
        />
        <StatCard
          label="Meals estimated"
          value={formatQuantity(data.meals.estimate)}
          hint={data.meals.formula}
        />
        <StatCard
          label="Open reservations"
          value={data.totals.pendingReservations}
          hint={`${data.totals.activeListings} active · ${data.totals.reservedListings} fully reserved listings`}
        />
      </div>

      <p className="fr-card mt-4 border-sky-200 bg-sky-50 p-4 text-sm text-sky-900" role="note">
        <strong>How meals are estimated:</strong> {data.meals.note}
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <BarChart
            title="Rescued kg per month"
            description="Last 6 months, verified pickups only. Bars show kilograms recorded in kg units."
            data={data.monthly.map((month) => ({ month: month.month, value: month.kg }))}
            unit="kg"
            emptyMessage="No verified pickups yet. Verify a pickup code and this chart starts filling up."
          />
        </div>

        <div className="space-y-4">
          <section className="fr-card p-5" aria-label="Breakdown by storage">
            <h2 className="text-base font-semibold text-stone-900">By storage type</h2>
            {data.byStorage.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">Nothing collected yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {data.byStorage.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-2">
                    <span className="text-stone-700">{humanizeEnum(row.key)}</span>
                    <span className="font-semibold text-stone-900">
                      {formatQuantity(row.kg)} kg · {row.pickups} pickup
                      {row.pickups === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="fr-card p-5" aria-label="Breakdown by category">
            <h2 className="text-base font-semibold text-stone-900">By category</h2>
            {data.byCategory.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">Nothing collected yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {data.byCategory.map((row) => (
                  <li key={row.key} className="flex items-center justify-between gap-2">
                    <span className="text-stone-700">{humanizeEnum(row.key)}</span>
                    <span className="font-semibold text-stone-900">
                      {formatQuantity(row.kg)} kg · {row.pickups} pickup
                      {row.pickups === 1 ? '' : 's'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <section className="mt-6" aria-labelledby="recent-heading">
        <h2 id="recent-heading" className="mb-3 text-lg font-semibold text-stone-900">
          Recent verified pickups
        </h2>
        {data.recentPickups.length === 0 ? (
          <EmptyState
            title="No verified pickups yet"
            description="Once a provider verifies a 6-digit code, the pickup is counted here."
          />
        ) : (
          <div className="fr-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Recent verified pickups</caption>
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Listing
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Quantity
                  </th>
                  <th scope="col" className="px-4 py-2">
                    From
                  </th>
                  <th scope="col" className="px-4 py-2">
                    To
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Collected
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.recentPickups.map((pickup) => (
                  <tr key={pickup.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2">{pickup.listingTitle}</td>
                    <td className="px-4 py-2">
                      {formatQuantity(pickup.quantity)} {pickup.unit}
                    </td>
                    <td className="px-4 py-2">{pickup.providerName}</td>
                    <td className="px-4 py-2">{pickup.recipientName}</td>
                    <td className="px-4 py-2">{formatDateTime(pickup.collectedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
