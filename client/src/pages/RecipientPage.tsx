import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { useAuth } from '../state/AuthContext';
import { CountdownBadge } from '../components/CountdownBadge';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Toasts,
} from '../components/ui';
import { formatDateTime, formatQuantity, humanizeEnum, pluralize } from '../lib/format';
import type { ImpactStats, ReservationView } from '@shared';

export function RecipientPage() {
  const { capabilities } = useAuth();
  const reservations = useApiQuery<{ reservations: ReservationView[] }>('/reservations');
  const impact = useApiQuery<ImpactStats>('/impact');
  const [toasts, setToasts] = useState<
    Array<{ id: number; tone: 'success' | 'error' | 'info'; text: string }>
  >([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [revealedCode, setRevealedCode] = useState<string | null>(null);

  function pushToast(tone: 'success' | 'error' | 'info', text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, text }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }

  const mine = reservations.data?.reservations ?? [];
  const active = mine.filter((reservation) => reservation.status === 'RESERVED');
  const past = mine.filter((reservation) => reservation.status !== 'RESERVED');

  async function cancelReservation(reservation: ReservationView) {
    const reason = window.prompt('Why are you cancelling? (optional)') ?? '';
    setBusyId(reservation.id);
    try {
      await api.post(`/reservations/${reservation.id}/cancel`, { reason });
      pushToast('success', 'Reservation cancelled — the food is back on the listing.');
      reservations.reload();
      impact.reload();
    } catch (cause) {
      pushToast('error', errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))}
      />
      <PageHeader
        title="My reservations"
        subtitle="Show the 6-digit code to the provider at pickup. Codes are single-use and expire with the pickup window."
        actions={
          <>
            <Link to="/browse" className="fr-btn-primary">
              Find more food
            </Link>
            <Link to="/impact" className="fr-btn-secondary">
              View impact
            </Link>
          </>
        }
      />

      {!capabilities?.canReserve ? (
        <p
          className="fr-card mb-6 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          {capabilities?.blockedReason ??
            'Your organization is pending approval, so you cannot reserve food yet.'}
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active reservations"
          value={active.length}
          hint={`${pluralize(past.length, 'past reservation')}`}
        />
        <StatCard
          label="Food collected"
          value={`${formatQuantity(impact.data?.totals.kg ?? 0)} kg`}
          hint="Verified pickups only"
        />
        <StatCard
          label="Meals estimated"
          value={formatQuantity(impact.data?.meals.estimate ?? 0)}
          hint={impact.data?.meals.formula ?? 'meals = rescued kg / 0.4 (estimate)'}
        />
      </div>

      <section aria-labelledby="active-heading">
        <h2 id="active-heading" className="mb-3 text-lg font-semibold text-stone-900">
          Active pickups
        </h2>
        {reservations.loading ? (
          <LoadingState label="Loading your reservations…" />
        ) : reservations.error ? (
          <ErrorState
            message={reservations.error}
            onRetry={reservations.reload}
            title="Could not load reservations"
          />
        ) : active.length === 0 ? (
          <EmptyState
            title="No active reservations"
            description="Browse listings near you and reserve a quantity inside the pickup window."
            action={
              <Link to="/browse" className="fr-btn-primary">
                Browse listings
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {active.map((reservation) => (
              <li key={reservation.id} className="fr-card border-emerald-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-900">
                      <Link to={`/listings/${reservation.listingId}`} className="hover:underline">
                        {reservation.listingTitle}
                      </Link>
                    </h3>
                    <p className="text-xs text-stone-600">
                      {reservation.provider.name} · {formatQuantity(reservation.quantity)}{' '}
                      {reservation.unit} · {humanizeEnum(reservation.listingStorage)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={reservation.status} />
                    <CountdownBadge expiresAt={reservation.pickupEnd} />
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-stone-500">Pickup code</p>
                    <p className="font-mono text-xl font-bold tracking-[0.3em] text-emerald-900">
                      {revealedCode === reservation.id ? (reservation.code ?? '••••••') : '••••••'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="fr-btn-secondary text-xs"
                    onClick={() =>
                      setRevealedCode(revealedCode === reservation.id ? null : reservation.id)
                    }
                    aria-expanded={revealedCode === reservation.id}
                  >
                    {revealedCode === reservation.id ? 'Hide code' : 'Reveal code'}
                  </button>
                  <p className="text-xs text-stone-600">
                    Pickup {formatDateTime(reservation.pickupStart)} →{' '}
                    {formatDateTime(reservation.pickupEnd)}
                  </p>
                </div>

                <p className="mt-2 text-xs text-stone-600">
                  <strong>Address:</strong> {reservation.pickupAddress ?? 'shared by the provider'}
                  {reservation.pickupInstructions ? ` — ${reservation.pickupInstructions}` : ''}
                </p>

                <button
                  type="button"
                  className="fr-btn-danger mt-3 text-xs"
                  onClick={() => void cancelReservation(reservation)}
                  disabled={busyId === reservation.id}
                >
                  {busyId === reservation.id ? 'Cancelling…' : 'Cancel reservation'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-heading" className="mt-8">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold text-stone-900">
          History
        </h2>
        {past.length === 0 ? (
          <p className="text-sm text-stone-600">
            Collected, cancelled and expired reservations will appear here.
          </p>
        ) : (
          <div className="fr-card overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Past reservations</caption>
              <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-4 py-2">
                    Listing
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Quantity
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Collected
                  </th>
                  <th scope="col" className="px-4 py-2">
                    Note
                  </th>
                </tr>
              </thead>
              <tbody>
                {past.map((reservation) => (
                  <tr key={reservation.id} className="border-b border-stone-100 last:border-0">
                    <td className="px-4 py-2">
                      <Link to={`/listings/${reservation.listingId}`} className="hover:underline">
                        {reservation.listingTitle}
                      </Link>
                    </td>
                    <td className="px-4 py-2">
                      {formatQuantity(reservation.quantity)} {reservation.unit}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={reservation.status} />
                    </td>
                    <td className="px-4 py-2">{formatDateTime(reservation.collectedAt)}</td>
                    <td className="px-4 py-2 text-xs text-stone-600">
                      {reservation.cancelReason ?? '—'}
                    </td>
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
