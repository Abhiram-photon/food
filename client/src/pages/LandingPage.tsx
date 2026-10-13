import { Link } from 'react-router-dom';
import { useApiQuery } from '../api/hooks';
import { useAuth } from '../state/AuthContext';
import { ErrorState, LoadingState, StatCard } from '../components/ui';
import { formatQuantity } from '../lib/format';

interface PublicImpact {
  pickups: number;
  kg: number;
  mealsEstimate: number;
  kgPerMeal: number;
  approvedProviders: number;
  approvedRecipients: number;
  activeListings: number;
}

export function LandingPage() {
  const { user } = useAuth();
  const stats = useApiQuery<PublicImpact>('/impact/public');

  return (
    <div className="space-y-12">
      <section className="grid gap-8 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="fr-badge bg-emerald-100 text-emerald-900">Surplus food rescue, relayed</p>
          <h1 className="mt-4 text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl">
            Good food should feed people, not bins.
          </h1>
          <p className="mt-4 text-base text-stone-700">
            <strong>1.05 billion tonnes of food were wasted in 2022</strong> across households, food
            service and retail levels — roughly 132 kg per person, or almost a fifth of all food
            available to consumers, according to the{' '}
            <a
              className="underline decoration-emerald-600 decoration-2 underline-offset-2"
              href="https://www.unep.org/resources/publication/food-waste-index-report-2024"
              target="_blank"
              rel="noreferrer"
            >
              UNEP Food Waste Index Report 2024
            </a>
            . At the same time, food banks and shelters turn away donations they cannot collect in
            time.
          </p>
          <p className="mt-3 text-base text-stone-700">
            FreshRelay is the missing middle: providers list surplus food with an expiry and a pickup
            window, nearby recipient organisations reserve it, and a 6-digit code proves the handover
            so rescued kilograms are counted honestly.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to={user ? '/provider' : '/register'} className="fr-btn-primary px-5 py-2.5 text-base">
              List surplus food
            </Link>
            <Link to={user ? '/browse' : '/register'} className="fr-btn-secondary px-5 py-2.5 text-base">
              Find food nearby
            </Link>
            <Link to="/browse" className="fr-btn-secondary px-5 py-2.5 text-base">
              Browse the map
            </Link>
          </div>
        </div>

        <div className="fr-card bg-gradient-to-br from-emerald-50 to-white p-6">
          <h2 className="text-lg font-semibold text-stone-900">How a rescue works</h2>
          <ol className="mt-4 space-y-4 text-sm text-stone-700">
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                1
              </span>
              <span>
                <strong>Provider lists</strong> surplus with quantity, storage type, allergens, pickup
                address, window and expiry. Drafts stay private until reviewed.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                2
              </span>
              <span>
                <strong>Recipient reserves</strong> a quantity inside the pickup window. Stock is
                decremented in a transaction, so two shelters never claim the same last box.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                3
              </span>
              <span>
                <strong>The code verifies</strong> the handover: the recipient shows their 6-digit code,
                the provider types it, and only then is the pickup counted as rescued food.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                4
              </span>
              <span>
                <strong>Impact updates</strong> with pickups, kilograms and an estimated meal count
                (kg ÷ 0.4, clearly labelled as an estimate).
              </span>
            </li>
          </ol>
        </div>
      </section>

      <section aria-label="Platform totals">
        {stats.loading ? (
          <LoadingState label="Loading platform totals…" />
        ) : stats.error ? (
          <ErrorState message={stats.error} onRetry={stats.reload} title="Could not load totals" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Food rescued" value={`${formatQuantity(stats.data?.kg ?? 0)} kg`} hint="Verified pickups only" />
            <StatCard label="Verified pickups" value={stats.data?.pickups ?? 0} />
            <StatCard
              label="Meals estimated"
              value={formatQuantity(stats.data?.mealsEstimate ?? 0)}
              hint={`kg ÷ ${stats.data?.kgPerMeal ?? 0.4} (estimate)`}
            />
            <StatCard
              label="Live listings"
              value={stats.data?.activeListings ?? 0}
              hint={`${stats.data?.approvedProviders ?? 0} providers · ${stats.data?.approvedRecipients ?? 0} recipients`}
            />
          </div>
        )}
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="fr-card p-5">
          <h3 className="text-base font-semibold text-stone-900">For bakeries & stores</h3>
          <p className="mt-2 text-sm text-stone-700">
            Turn end-of-day surplus into community impact with 3 taps. Pause or cancel a listing any
            time, and see exactly who is collecting and when.
          </p>
        </div>
        <div className="fr-card p-5">
          <h3 className="text-base font-semibold text-stone-900">For caterers & households</h3>
          <p className="mt-2 text-sm text-stone-700">
            Large event leftovers or a household excess pantry run can be listed with a pickup window
            that fits your schedule.
          </p>
        </div>
        <div className="fr-card p-5">
          <h3 className="text-base font-semibold text-stone-900">For food banks & shelters</h3>
          <p className="mt-2 text-sm text-stone-700">
            Search within 5–50 km, filter by storage type, sort by the listings ending soonest, and
            reserve the quantities your kitchen can use today.
          </p>
        </div>
      </section>
    </div>
  );
}
