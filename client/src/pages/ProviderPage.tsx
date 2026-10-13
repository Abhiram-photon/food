import { useMemo, useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { useAuth } from '../state/AuthContext';
import { CountdownBadge } from '../components/CountdownBadge';
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatusBadge,
  Toasts,
} from '../components/ui';
import { formatDateTime, formatQuantity, humanizeEnum } from '../lib/format';
import {
  CATEGORIES,
  STORAGE_TYPES,
  UNIT_SUGGESTIONS,
  type OwnerListing,
  type ReservationView,
} from '@shared';

const emptyForm = {
  title: '',
  description: '',
  category: 'BAKERY',
  quantity: '10',
  unit: 'kg',
  allergens: '',
  storage: 'AMBIENT',
  pickupAddress: '',
  latitude: '17.385',
  longitude: '78.4867',
  windowStart: '',
  windowEnd: '',
  expiresAt: '',
  pickupInstructions: '',
};

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

export function ProviderPage() {
  const { capabilities } = useAuth();
  const listings = useApiQuery<{ listings: OwnerListing[] }>('/provider/listings');
  const reservations = useApiQuery<{ reservations: ReservationView[] }>('/provider/reservations');
  const [toasts, setToasts] = useState<
    Array<{ id: number; tone: 'success' | 'error' | 'info'; text: string }>
  >([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [verifyCode, setVerifyCode] = useState('');
  const [verifyReservationId, setVerifyReservationId] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  function pushToast(tone: 'success' | 'error' | 'info', text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, text }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }

  // Default the window fields to "now → +4 hours" once, for a smoother first create.
  useEffect(() => {
    const now = new Date();
    const end = new Date(now.getTime() + 4 * 3600_000);
    setForm((current) =>
      current.windowStart
        ? current
        : {
            ...current,
            windowStart: toLocalInput(now.toISOString()),
            windowEnd: toLocalInput(end.toISOString()),
          },
    );
  }, []);

  const myListings = listings.data?.listings ?? [];
  const incoming = useMemo(() => reservations.data?.reservations ?? [], [reservations.data]);
  const pendingVerifications = useMemo(
    () => incoming.filter((reservation) => reservation.status === 'RESERVED'),
    [incoming],
  );

  function startCreate() {
    setEditingId(null);
    setForm({ ...emptyForm });
    const now = new Date();
    const end = new Date(now.getTime() + 4 * 3600_000);
    setForm((current) => ({
      ...current,
      windowStart: toLocalInput(now.toISOString()),
      windowEnd: toLocalInput(end.toISOString()),
    }));
    setFormError(null);
  }

  function startEdit(listing: OwnerListing) {
    setEditingId(listing.id);
    setFormError(null);
    setForm({
      title: listing.title,
      description: listing.description,
      category: listing.category,
      quantity: String(listing.quantity),
      unit: listing.unit,
      allergens: listing.allergens.join(', '),
      storage: listing.storage,
      pickupAddress: listing.pickupAddress,
      latitude: String(listing.latitude),
      longitude: String(listing.longitude),
      windowStart: toLocalInput(listing.windowStart),
      windowEnd: toLocalInput(listing.windowEnd),
      expiresAt: toLocalInput(listing.expiresAt),
      pickupInstructions: listing.pickupInstructions,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function buildPayload() {
    return {
      title: form.title.trim(),
      description: form.description.trim(),
      category: form.category,
      quantity: Number(form.quantity),
      unit: form.unit.trim() || 'kg',
      allergens: form.allergens,
      storage: form.storage,
      pickupAddress: form.pickupAddress.trim(),
      latitude: Number(form.latitude),
      longitude: Number(form.longitude),
      windowStart: new Date(form.windowStart).toISOString(),
      windowEnd: new Date(form.windowEnd).toISOString(),
      ...(form.expiresAt ? { expiresAt: new Date(form.expiresAt).toISOString() } : {}),
      pickupInstructions: form.pickupInstructions.trim(),
    };
  }

  async function saveListing(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const payload = buildPayload();
      if (editingId) {
        await api.patch(`/listings/${editingId}`, payload);
        pushToast('success', 'Listing updated.');
      } else {
        const created = await api.post<{ listing: OwnerListing }>('/listings', payload);
        pushToast('success', 'Draft saved. Publish it when you are ready.');
        setEditingId(created.listing.id);
      }
      listings.reload();
    } catch (cause) {
      setFormError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  async function runAction(
    listing: OwnerListing,
    action: 'PUBLISH' | 'PAUSE' | 'RESUME' | 'CANCEL',
  ) {
    setBusyId(listing.id);
    try {
      const reason =
        action === 'CANCEL'
          ? (window.prompt('Reason for cancelling this listing?') ?? 'Listing cancelled')
          : undefined;
      const response = await api.post<{ cancelledReservations: number }>(
        `/listings/${listing.id}/status`,
        {
          action,
          ...(reason ? { reason } : {}),
        },
      );
      if (action === 'CANCEL' && response.cancelledReservations > 0) {
        pushToast(
          'info',
          `Listing cancelled — ${response.cancelledReservations} reservation(s) released.`,
        );
      } else {
        pushToast('success', `Listing ${action.toLowerCase()}d.`);
      }
      listings.reload();
      reservations.reload();
    } catch (cause) {
      pushToast('error', errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  async function cancelReservation(reservation: ReservationView) {
    const reason = window.prompt('Reason for cancelling this reservation? (required)');
    if (!reason) return;
    try {
      await api.post(`/reservations/${reservation.id}/cancel`, { reason });
      pushToast('success', 'Reservation cancelled and stock restored.');
      reservations.reload();
      listings.reload();
    } catch (cause) {
      pushToast('error', errorMessage(cause));
    }
  }

  async function verifyPickup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setVerifying(true);
    setVerifyError(null);
    setVerifySuccess(null);
    try {
      const response = await api.post<{ reservation: ReservationView }>('/reservations/verify', {
        code: verifyCode.trim(),
        ...(verifyReservationId ? { reservationId: verifyReservationId } : {}),
      });
      setVerifySuccess(
        `Verified! ${formatQuantity(response.reservation.quantity)} ${response.reservation.unit} handed over to ${response.reservation.recipient.name}.`,
      );
      setVerifyCode('');
      setVerifyReservationId('');
      reservations.reload();
      listings.reload();
    } catch (cause) {
      setVerifyError(errorMessage(cause));
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div>
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))}
      />
      <PageHeader
        title="Provider workspace"
        subtitle="List surplus food, watch reservations come in, and verify pickups with the recipient's code."
        actions={
          <>
            <button type="button" className="fr-btn-secondary" onClick={startCreate}>
              New listing
            </button>
            <Link to="/impact" className="fr-btn-secondary">
              View impact
            </Link>
          </>
        }
      />

      {!capabilities?.canPublishListing ? (
        <p
          className="fr-card mb-6 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          {capabilities?.blockedReason ??
            'Your organization is not approved yet, so listings stay as drafts.'}{' '}
          You can still save drafts — publishing unlocks after admin approval.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="create-heading" className="lg:col-span-2">
          <div className="fr-card p-5">
            <h2 id="create-heading" className="text-base font-semibold text-stone-900">
              {editingId ? 'Edit listing' : 'Create a listing'}
            </h2>
            <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={saveListing} noValidate>
              {formError ? (
                <p
                  className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-2"
                  role="alert"
                >
                  {formError}
                </p>
              ) : null}

              <div className="sm:col-span-2">
                <Field label="Title" htmlFor="title" required>
                  <input
                    id="title"
                    className="fr-input"
                    value={form.title}
                    onChange={(event) => setForm({ ...form, title: event.target.value })}
                    required
                  />
                </Field>
              </div>

              <div className="sm:col-span-2">
                <Field label="Description" htmlFor="description">
                  <textarea
                    id="description"
                    className="fr-input"
                    rows={2}
                    value={form.description}
                    onChange={(event) => setForm({ ...form, description: event.target.value })}
                  />
                </Field>
              </div>

              <Field label="Category" htmlFor="category" required>
                <select
                  id="category"
                  className="fr-input"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {humanizeEnum(category)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Storage" htmlFor="storage" required>
                <select
                  id="storage"
                  className="fr-input"
                  value={form.storage}
                  onChange={(event) => setForm({ ...form, storage: event.target.value })}
                >
                  {STORAGE_TYPES.map((storage) => (
                    <option key={storage} value={storage}>
                      {humanizeEnum(storage)}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Quantity" htmlFor="quantity" required>
                <input
                  id="quantity"
                  className="fr-input"
                  type="number"
                  min="1"
                  step="1"
                  value={form.quantity}
                  onChange={(event) => setForm({ ...form, quantity: event.target.value })}
                />
              </Field>

              <Field
                label="Unit"
                htmlFor="unit"
                required
                hint={`e.g. ${UNIT_SUGGESTIONS.join(', ')}`}
              >
                <input
                  id="unit"
                  className="fr-input"
                  value={form.unit}
                  onChange={(event) => setForm({ ...form, unit: event.target.value })}
                  list="unit-options"
                />
              </Field>
              <datalist id="unit-options">
                {UNIT_SUGGESTIONS.map((unit) => (
                  <option key={unit} value={unit} />
                ))}
              </datalist>

              <div className="sm:col-span-2">
                <Field
                  label="Allergens"
                  htmlFor="allergens"
                  hint="Comma separated, e.g. gluten, milk, nuts. Leave empty if none."
                >
                  <input
                    id="allergens"
                    className="fr-input"
                    value={form.allergens}
                    onChange={(event) => setForm({ ...form, allergens: event.target.value })}
                  />
                </Field>
              </div>

              <div className="sm:col-span-2">
                <Field label="Pickup address" htmlFor="pickupAddress" required>
                  <input
                    id="pickupAddress"
                    className="fr-input"
                    value={form.pickupAddress}
                    onChange={(event) => setForm({ ...form, pickupAddress: event.target.value })}
                    autoComplete="street-address"
                  />
                </Field>
              </div>

              <Field label="Latitude" htmlFor="latitude" required>
                <input
                  id="latitude"
                  className="fr-input"
                  type="number"
                  step="0.0001"
                  value={form.latitude}
                  onChange={(event) => setForm({ ...form, latitude: event.target.value })}
                />
              </Field>

              <Field label="Longitude" htmlFor="longitude" required>
                <input
                  id="longitude"
                  className="fr-input"
                  type="number"
                  step="0.0001"
                  value={form.longitude}
                  onChange={(event) => setForm({ ...form, longitude: event.target.value })}
                />
              </Field>

              <Field label="Pickup window starts" htmlFor="windowStart" required>
                <input
                  id="windowStart"
                  className="fr-input"
                  type="datetime-local"
                  value={form.windowStart}
                  onChange={(event) => setForm({ ...form, windowStart: event.target.value })}
                />
              </Field>

              <Field label="Pickup window ends" htmlFor="windowEnd" required>
                <input
                  id="windowEnd"
                  className="fr-input"
                  type="datetime-local"
                  value={form.windowEnd}
                  onChange={(event) => setForm({ ...form, windowEnd: event.target.value })}
                />
              </Field>

              <div className="sm:col-span-2">
                <Field
                  label="Food expires at"
                  htmlFor="expiresAt"
                  hint="Defaults to the end of the pickup window. It cannot be later than that."
                >
                  <input
                    id="expiresAt"
                    className="fr-input"
                    type="datetime-local"
                    value={form.expiresAt}
                    onChange={(event) => setForm({ ...form, expiresAt: event.target.value })}
                  />
                </Field>
              </div>

              <div className="sm:col-span-2">
                <Field label="Pickup instructions" htmlFor="pickupInstructions">
                  <textarea
                    id="pickupInstructions"
                    className="fr-input"
                    rows={2}
                    value={form.pickupInstructions}
                    onChange={(event) =>
                      setForm({ ...form, pickupInstructions: event.target.value })
                    }
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="submit" className="fr-btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save draft'}
                </button>
                <button type="button" className="fr-btn-secondary" onClick={startCreate}>
                  Reset form
                </button>
                {editingId ? (
                  <button
                    type="button"
                    className="fr-btn-secondary"
                    onClick={() => void runAction({ id: editingId } as OwnerListing, 'PUBLISH')}
                    disabled={busyId === editingId}
                  >
                    Publish now
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </section>

        <section aria-labelledby="my-listings-heading">
          <h2 id="my-listings-heading" className="mb-3 text-lg font-semibold text-stone-900">
            My listings
          </h2>
          {listings.loading ? (
            <LoadingState label="Loading your listings…" />
          ) : listings.error ? (
            <ErrorState
              message={listings.error}
              onRetry={listings.reload}
              title="Could not load listings"
            />
          ) : myListings.length === 0 ? (
            <EmptyState
              title="No listings yet"
              description="Create your first listing with the form above. It starts as a draft until you publish it."
            />
          ) : (
            <ul className="space-y-3">
              {myListings.map((listing) => (
                <li key={listing.id} className="fr-card p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stone-900">
                      <Link to={`/listings/${listing.id}`} className="hover:underline">
                        {listing.title}
                      </Link>
                    </h3>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={listing.status} />
                      {listing.status === 'ACTIVE' || listing.status === 'RESERVED_OUT' ? (
                        <CountdownBadge
                          expiresAt={listing.expiresAt}
                          secondsLeft={listing.secondsLeft}
                        />
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-stone-600">
                    {formatQuantity(listing.quantityRemaining)} of{' '}
                    {formatQuantity(listing.quantity)} {listing.unit} available · window ends{' '}
                    {formatDateTime(listing.windowEnd)}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {listing.reservedCount} pending · {listing.collectedCount} collected ·{' '}
                    {humanizeEnum(listing.storage)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="fr-btn-secondary text-xs"
                      onClick={() => startEdit(listing)}
                    >
                      Edit
                    </button>
                    {listing.status === 'DRAFT' || listing.status === 'PAUSED' ? (
                      <button
                        type="button"
                        className="fr-btn-primary text-xs"
                        onClick={() => void runAction(listing, 'PUBLISH')}
                        disabled={busyId === listing.id || !capabilities?.canPublishListing}
                        title={
                          capabilities?.canPublishListing
                            ? undefined
                            : (capabilities?.blockedReason ?? '')
                        }
                      >
                        {listing.status === 'DRAFT' ? 'Publish' : 'Resume'}
                      </button>
                    ) : null}
                    {listing.status === 'ACTIVE' || listing.status === 'RESERVED_OUT' ? (
                      <button
                        type="button"
                        className="fr-btn-secondary text-xs"
                        onClick={() => void runAction(listing, 'PAUSE')}
                        disabled={busyId === listing.id}
                      >
                        Pause
                      </button>
                    ) : null}
                    {listing.status !== 'CANCELLED' && listing.status !== 'EXPIRED' ? (
                      <button
                        type="button"
                        className="fr-btn-danger text-xs"
                        onClick={() => void runAction(listing, 'CANCEL')}
                        disabled={busyId === listing.id}
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="verify-heading" className="space-y-6">
          <div className="fr-card p-5">
            <h2 id="verify-heading" className="text-base font-semibold text-stone-900">
              Verify a pickup code
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Ask the recipient for their 6-digit code. Codes only work inside the pickup window,
              once.
            </p>
            <form className="mt-4 space-y-3" onSubmit={verifyPickup}>
              {verifyError ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">
                  {verifyError}
                </p>
              ) : null}
              {verifySuccess ? (
                <p
                  className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
                  role="status"
                >
                  {verifySuccess}
                </p>
              ) : null}
              <Field label="Pickup code" htmlFor="verifyCode" required hint="6 digits, no spaces.">
                <input
                  id="verifyCode"
                  className="fr-input tracking-[0.3em]"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(event) =>
                    setVerifyCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                  }
                  required
                />
              </Field>
              <Field
                label="Reservation (optional)"
                htmlFor="verifyReservationId"
                hint="Pick the reservation for precise attempt tracking, or leave empty to verify by code alone."
              >
                <select
                  id="verifyReservationId"
                  className="fr-input"
                  value={verifyReservationId}
                  onChange={(event) => setVerifyReservationId(event.target.value)}
                >
                  <option value="">Detect from the code</option>
                  {pendingVerifications.map((reservation) => (
                    <option key={reservation.id} value={reservation.id}>
                      {reservation.recipient.name} · {formatQuantity(reservation.quantity)}{' '}
                      {reservation.unit} · {reservation.listingTitle}
                    </option>
                  ))}
                </select>
              </Field>
              <button type="submit" className="fr-btn-primary w-full" disabled={verifying}>
                {verifying ? 'Verifying…' : 'Verify pickup'}
              </button>
            </form>
          </div>

          <div>
            <h2 className="mb-3 text-lg font-semibold text-stone-900">Incoming reservations</h2>
            {reservations.loading ? (
              <LoadingState label="Loading reservations…" />
            ) : reservations.error ? (
              <ErrorState
                message={reservations.error}
                onRetry={reservations.reload}
                title="Could not load reservations"
              />
            ) : incoming.length === 0 ? (
              <EmptyState
                title="No reservations yet"
                description="When a recipient reserves one of your listings it will appear here with the pickup window."
              />
            ) : (
              <ul className="space-y-3">
                {incoming.map((reservation) => (
                  <li key={reservation.id} className="fr-card p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-stone-900">
                          {reservation.recipient.name}
                        </h3>
                        <p className="text-xs text-stone-600">
                          {reservation.listingTitle} · {formatQuantity(reservation.quantity)}{' '}
                          {reservation.unit}
                        </p>
                      </div>
                      <StatusBadge status={reservation.status} />
                    </div>
                    <p className="mt-2 text-xs text-stone-600">
                      Pickup {formatDateTime(reservation.pickupStart)} →{' '}
                      {formatDateTime(reservation.pickupEnd)}
                    </p>
                    {reservation.cancelReason ? (
                      <p className="mt-1 text-xs text-red-700">
                        Cancelled: {reservation.cancelReason}
                      </p>
                    ) : null}
                    {reservation.status === 'RESERVED' ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="fr-btn-secondary text-xs"
                          onClick={() => {
                            setVerifyReservationId(reservation.id);
                            setVerifyCode('');
                            setVerifyError(null);
                            document.getElementById('verifyCode')?.focus();
                          }}
                        >
                          Verify this pickup
                        </button>
                        <button
                          type="button"
                          className="fr-btn-danger text-xs"
                          onClick={() => void cancelReservation(reservation)}
                        >
                          Cancel reservation
                        </button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
