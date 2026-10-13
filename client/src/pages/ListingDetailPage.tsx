import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { useAuth } from '../state/AuthContext';
import { CountdownBadge } from '../components/CountdownBadge';
import { ErrorState, Field, LoadingState, StatusBadge } from '../components/ui';
import { formatDateTime, formatDistance, formatQuantity, humanizeEnum } from '../lib/format';
import type { CreateReservationResponse, ListingDetailResponse } from '@shared';

export function ListingDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user, capabilities } = useAuth();
  const { data, loading, error, reload } = useApiQuery<ListingDetailResponse>(`/listings/${id}`);

  const [quantity, setQuantity] = useState('1');
  const [pickupStart, setPickupStart] = useState('');
  const [pickupEnd, setPickupEnd] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<CreateReservationResponse | null>(null);

  const listing = data?.listing;

  async function handleReserve(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await api.post<CreateReservationResponse>(`/listings/${id}/reservations`, {
        quantity: Number(quantity),
        ...(pickupStart ? { pickupStart: new Date(pickupStart).toISOString() } : {}),
        ...(pickupEnd ? { pickupEnd: new Date(pickupEnd).toISOString() } : {}),
        note,
      });
      setSuccess(response);
      reload();
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingState label="Loading listing…" />;
  if (error)
    return <ErrorState message={error} onRetry={reload} title="Could not load this listing" />;
  if (!listing) return <ErrorState message="Listing not found." title="Not found" />;

  const blockedReason = data?.reservationBlockedReason ?? null;
  const maxQuantity = Math.max(0, listing.quantityRemaining);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div className="fr-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-stone-900">{listing.title}</h1>
              <p className="mt-1 text-sm text-stone-600">
                {listing.provider.name} · {humanizeEnum(listing.provider.type)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CountdownBadge
                expiresAt={listing.expiresAt}
                secondsLeft={listing.secondsLeft}
                label="Expires"
              />
              <StatusBadge status={listing.status} />
            </div>
          </div>

          <p className="mt-4 whitespace-pre-line text-sm text-stone-800">{listing.description}</p>

          <dl className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Available now</dt>
              <dd className="text-sm font-semibold text-stone-900">
                {formatQuantity(listing.quantityRemaining)} of {formatQuantity(listing.quantity)}{' '}
                {listing.unit}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Category</dt>
              <dd className="text-sm text-stone-900">{humanizeEnum(listing.category)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Storage</dt>
              <dd className="text-sm text-stone-900">{humanizeEnum(listing.storage)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Allergens</dt>
              <dd className="text-sm text-stone-900">
                {listing.allergens.length ? listing.allergens.join(', ') : 'None listed'}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Pickup window</dt>
              <dd className="text-sm text-stone-900">
                {formatDateTime(listing.windowStart)} → {formatDateTime(listing.windowEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Food expires</dt>
              <dd className="text-sm text-stone-900">{formatDateTime(listing.expiresAt)}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">Pickup address</dt>
              <dd className="text-sm text-stone-900">
                {data?.listing.pickupAddress ? (
                  <>
                    {data.listing.pickupAddress}
                    {listing.distanceKm !== null ? (
                      <span className="block text-xs text-stone-500">
                        {formatDistance(listing.distanceKm)}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-stone-500">
                    Hidden until you hold a reservation (approx.{' '}
                    {listing.approximateLatitude.toFixed(2)},{' '}
                    {listing.approximateLongitude.toFixed(2)})
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-stone-500">
                Pickup instructions
              </dt>
              <dd className="text-sm text-stone-900">
                {data?.listing.pickupInstructions ?? 'Shared with the recipient after reserving.'}
              </dd>
            </div>
          </dl>
        </div>

        {data?.myReservation ? (
          <div className="fr-card border-emerald-200 bg-emerald-50 p-6">
            <h2 className="text-base font-semibold text-emerald-900">
              You already reserved this listing
            </h2>
            <p className="mt-1 text-sm text-emerald-800">
              {formatQuantity(data.myReservation.quantity)} {listing.unit} · pickup{' '}
              {formatDateTime(data.myReservation.pickupStart)} →{' '}
              {formatDateTime(data.myReservation.pickupEnd)}
            </p>
            {data.myReservation.code ? (
              <p className="mt-3 text-2xl font-bold tracking-[0.3em] text-emerald-900">
                {data.myReservation.code}
              </p>
            ) : null}
            <Link to="/recipient" className="fr-btn-primary mt-4">
              View my reservations
            </Link>
          </div>
        ) : null}
      </div>

      <aside className="space-y-4">
        <div className="fr-card p-6">
          <h2 className="text-base font-semibold text-stone-900">Reserve a pickup</h2>

          {success ? (
            <div className="mt-3 space-y-3" role="status">
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Reserved! Show this code at pickup.
              </p>
              <p className="text-center text-3xl font-bold tracking-[0.3em] text-emerald-900">
                {success.pickupCode}
              </p>
              <p className="text-sm text-stone-600">
                {formatQuantity(success.reservation.quantity)} {success.reservation.unit} reserved
                for {formatDateTime(success.reservation.pickupStart)} →{' '}
                {formatDateTime(success.reservation.pickupEnd)}
              </p>
              <div className="flex gap-2">
                <Link to="/recipient" className="fr-btn-primary flex-1">
                  My reservations
                </Link>
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => {
                    setSuccess(null);
                    navigate(0);
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>
          ) : (
            <form className="mt-3 space-y-4" onSubmit={handleReserve}>
              {blockedReason ? (
                <p
                  className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  role="status"
                >
                  {blockedReason}
                </p>
              ) : null}

              {formError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {formError}
                </p>
              ) : null}

              <Field
                label={`Quantity (${listing.unit})`}
                htmlFor="quantity"
                required
                hint={`Minimum 1, maximum ${formatQuantity(maxQuantity)} available.`}
              >
                <input
                  id="quantity"
                  className="fr-input"
                  type="number"
                  min="1"
                  max={maxQuantity}
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  disabled={Boolean(blockedReason)}
                  required
                />
              </Field>

              <Field
                label="Pickup from"
                htmlFor="pickupStart"
                hint={`Inside the provider window (${formatDateTime(listing.windowStart)} → ${formatDateTime(listing.windowEnd)}).`}
              >
                <input
                  id="pickupStart"
                  className="fr-input"
                  type="datetime-local"
                  value={pickupStart}
                  onChange={(event) => setPickupStart(event.target.value)}
                  disabled={Boolean(blockedReason)}
                />
              </Field>

              <Field
                label="Pickup until"
                htmlFor="pickupEnd"
                hint="Defaults to the end of the provider window."
              >
                <input
                  id="pickupEnd"
                  className="fr-input"
                  type="datetime-local"
                  value={pickupEnd}
                  onChange={(event) => setPickupEnd(event.target.value)}
                  disabled={Boolean(blockedReason)}
                />
              </Field>

              <Field
                label="Note for the provider"
                htmlFor="note"
                hint="Optional — e.g. van size or arrival time."
              >
                <textarea
                  id="note"
                  className="fr-input"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  disabled={Boolean(blockedReason)}
                />
              </Field>

              <button
                type="submit"
                className="fr-btn-primary w-full"
                disabled={Boolean(blockedReason) || submitting}
              >
                {submitting
                  ? 'Reserving…'
                  : blockedReason
                    ? 'Reservation unavailable'
                    : 'Reserve pickup'}
              </button>

              {!user ? (
                <p className="text-sm text-stone-600">
                  <Link to="/login" className="font-semibold text-emerald-700 underline">
                    Sign in
                  </Link>{' '}
                  or{' '}
                  <Link to="/register" className="font-semibold text-emerald-700 underline">
                    register
                  </Link>{' '}
                  as a recipient organization.
                </p>
              ) : null}

              {user && capabilities?.blockedReason ? (
                <p className="text-xs text-stone-600">{capabilities.blockedReason}</p>
              ) : null}
            </form>
          )}
        </div>

        <div className="fr-card p-4 text-sm text-stone-600">
          <h2 className="text-sm font-semibold text-stone-800">Safety notes</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Check allergens and storage conditions before you distribute.</li>
            <li>Bring insulated bags for HOT or CHILLED food.</li>
            <li>Codes are single-use and lock after 5 wrong attempts.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
