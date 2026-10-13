import { Link } from 'react-router-dom';
import type { PublicListing } from '@shared';
import { CountdownBadge } from './CountdownBadge';
import { StatusBadge } from './ui';
import { formatDistance, formatQuantity, humanizeEnum } from '../lib/format';

const STORAGE_ICONS: Record<string, string> = {
  AMBIENT: '🧺',
  CHILLED: '❄️',
  FROZEN: '🧊',
  HOT: '🔥',
};

export interface ListingCardProps {
  listing: PublicListing;
  onFocus?: (listing: PublicListing) => void;
  highlighted?: boolean;
}

export function ListingCard({ listing, onFocus, highlighted }: ListingCardProps) {
  const fullyReserved = listing.quantityRemaining <= 0 || listing.status === 'RESERVED_OUT';

  return (
    <article
      className={`fr-card p-4 transition-shadow hover:shadow-md ${
        highlighted ? 'ring-2 ring-emerald-500' : ''
      }`}
      onMouseEnter={() => onFocus?.(listing)}
      data-testid="listing-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-stone-900">
          <Link
            to={`/listings/${listing.id}`}
            className="rounded underline-offset-2 hover:underline"
          >
            {listing.title}
          </Link>
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <CountdownBadge expiresAt={listing.expiresAt} secondsLeft={listing.secondsLeft} />
          <StatusBadge status={listing.status} />
        </div>
      </div>

      <p className="mt-1 line-clamp-2 text-sm text-stone-600">{listing.description}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Available</dt>
          <dd className="font-semibold text-stone-900">
            {formatQuantity(listing.quantityRemaining)} / {formatQuantity(listing.quantity)}{' '}
            <span className="font-normal text-stone-600">{listing.unit}</span>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Storage</dt>
          <dd className="text-stone-900">
            {STORAGE_ICONS[listing.storage] ?? ''} {humanizeEnum(listing.storage)}
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Category</dt>
          <dd className="text-stone-900">{humanizeEnum(listing.category)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-stone-500">Distance</dt>
          <dd className="text-stone-900">
            {formatDistance(listing.distanceKm) || 'Provider location hidden'}
          </dd>
        </div>
      </dl>

      {listing.allergens.length > 0 ? (
        <p className="mt-2 text-xs text-amber-800">Contains: {listing.allergens.join(', ')}</p>
      ) : null}

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-stone-500">
          {listing.provider.name} · {humanizeEnum(listing.provider.type)} · pickup by{' '}
          {new Date(listing.windowEnd).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </p>
        <Link
          to={`/listings/${listing.id}`}
          className={`fr-btn text-sm ${fullyReserved ? 'fr-btn-secondary' : 'fr-btn-primary'}`}
        >
          {fullyReserved ? 'View details' : 'Reserve'}
        </Link>
      </div>
    </article>
  );
}
