import { useState } from 'react';
import { api, errorMessage } from '../api/client';
import { useApiQuery } from '../api/hooks';
import { BarChart } from '../components/BarChart';
import {
  EmptyState,
  ErrorState,
  Field,
  LoadingState,
  PageHeader,
  StatCard,
  StatusBadge,
  Toasts,
} from '../components/ui';
import { formatDate, formatQuantity, humanizeEnum } from '../lib/format';
import type { AdminOrganizationView, PlatformTotals } from '@shared';

export function AdminPage() {
  const [statusFilter, setStatusFilter] = useState('PENDING');
  const organizations = useApiQuery<{ organizations: AdminOrganizationView[] }>(
    `/admin/organizations${statusFilter ? `?status=${statusFilter}` : ''}`,
  );
  const totals = useApiQuery<PlatformTotals>('/admin/totals');
  const [toasts, setToasts] = useState<
    Array<{ id: number; tone: 'success' | 'error' | 'info'; text: string }>
  >([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  function pushToast(tone: 'success' | 'error' | 'info', text: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, text }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }

  async function review(organization: AdminOrganizationView, decision: 'APPROVE' | 'REJECT') {
    setBusyId(organization.id);
    setReviewError(null);
    try {
      await api.post(`/admin/organizations/${organization.id}/review`, {
        decision,
        note: notes[organization.id] ?? '',
      });
      pushToast(
        'success',
        `${organization.name} ${decision === 'APPROVE' ? 'approved' : 'rejected'}.`,
      );
      organizations.reload();
      totals.reload();
    } catch (cause) {
      setReviewError(errorMessage(cause));
    } finally {
      setBusyId(null);
    }
  }

  const rows = organizations.data?.organizations ?? [];

  return (
    <div>
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))}
      />
      <PageHeader
        title="Admin console"
        subtitle="Approve organizations before they can publish or reserve, and watch platform totals."
      />

      <section aria-labelledby="totals-heading" className="mb-8">
        <h2 id="totals-heading" className="mb-3 text-lg font-semibold text-stone-900">
          Platform totals
        </h2>
        {totals.loading ? (
          <LoadingState label="Loading totals…" />
        ) : totals.error ? (
          <ErrorState
            message={totals.error}
            onRetry={totals.reload}
            title="Could not load totals"
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                label="Organizations"
                value={totals.data?.organizations.total ?? 0}
                hint={`${totals.data?.organizations.pending ?? 0} pending · ${totals.data?.organizations.approved ?? 0} approved`}
              />
              <StatCard
                label="Listings"
                value={totals.data?.listings.total ?? 0}
                hint={`${totals.data?.listings.active ?? 0} active · ${totals.data?.listings.reservedOut ?? 0} reserved out`}
              />
              <StatCard
                label="Collected pickups"
                value={totals.data?.reservations.collected ?? 0}
                hint={`${totals.data?.reservations.reserved ?? 0} open · ${totals.data?.reservations.cancelled ?? 0} cancelled`}
              />
              <StatCard
                label="Food rescued"
                value={`${formatQuantity(totals.data?.impact.kg ?? 0)} kg`}
                hint={`${formatQuantity(totals.data?.impact.mealsEstimate ?? 0)} meals estimated (÷ ${totals.data?.impact.kgPerMeal ?? 0.4})`}
              />
            </div>
            <div className="mt-6">
              <BarChart
                title="Rescued kg per month"
                description="Verified pickups across the platform."
                data={(totals.data?.monthly ?? []).map((month) => ({
                  month: month.month,
                  value: month.kg,
                }))}
                unit="kg"
              />
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="orgs-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <h2 id="orgs-heading" className="text-lg font-semibold text-stone-900">
            Organizations
          </h2>
          <Field label="Filter by status" htmlFor="statusFilter">
            <select
              id="statusFilter"
              className="fr-input"
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="PENDING">Pending review</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="">All</option>
            </select>
          </Field>
        </div>

        {reviewError ? (
          <p
            className="fr-card mb-3 border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {reviewError}
          </p>
        ) : null}

        {organizations.loading ? (
          <LoadingState label="Loading organizations…" />
        ) : organizations.error ? (
          <ErrorState
            message={organizations.error}
            onRetry={organizations.reload}
            title="Could not load organizations"
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Nothing to review"
            description="No organizations match this filter right now. New registrations appear here as PENDING."
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((organization) => (
              <li key={organization.id} className="fr-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-900">{organization.name}</h3>
                    <p className="text-xs text-stone-600">
                      {humanizeEnum(organization.type)} · {humanizeEnum(organization.role)} ·{' '}
                      {organization.contactEmail}
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      {organization.address ?? 'No address given'}
                      {organization.latitude !== null && organization.longitude !== null
                        ? ` · ${organization.latitude.toFixed(3)}, ${organization.longitude.toFixed(3)}`
                        : ''}
                    </p>
                    <p className="mt-1 text-xs text-stone-500">
                      Registered {formatDate(organization.createdAt)} · {organization.userCount}{' '}
                      user(s) · {organization.listingCount} listings ·{' '}
                      {organization.reservationCount} reservations
                    </p>
                    {organization.reviewNote ? (
                      <p className="mt-1 text-xs text-stone-600">
                        Last note: {organization.reviewNote}
                      </p>
                    ) : null}
                  </div>
                  <StatusBadge status={organization.status} />
                </div>

                {organization.status === 'PENDING' ? (
                  <div className="mt-3 space-y-2">
                    <Field
                      label={`Review note for ${organization.name}`}
                      htmlFor={`note-${organization.id}`}
                      hint="Shown to the organization in their notification and email."
                    >
                      <input
                        id={`note-${organization.id}`}
                        className="fr-input"
                        value={notes[organization.id] ?? ''}
                        onChange={(event) =>
                          setNotes((current) => ({
                            ...current,
                            [organization.id]: event.target.value,
                          }))
                        }
                        placeholder="e.g. Food safety certificate verified"
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="fr-btn-primary text-sm"
                        onClick={() => void review(organization, 'APPROVE')}
                        disabled={busyId === organization.id}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="fr-btn-danger text-sm"
                        onClick={() => void review(organization, 'REJECT')}
                        disabled={busyId === organization.id}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
