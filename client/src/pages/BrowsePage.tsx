import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApiQuery } from '../api/hooks';
import { LoadingState, ErrorState, EmptyState, PageHeader, Field } from '../components/ui';
import { ListingCard } from '../components/ListingCard';
import { MapView } from '../components/MapView';
import { humanizeEnum } from '../lib/format';
import { STORAGE_TYPES, type PublicListing, type SearchResponse } from '@shared';

const HYDERABAD = { lat: 17.385, lng: 78.4867 };

export function BrowsePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(true);

  const lat = searchParams.get('lat') ?? String(HYDERABAD.lat);
  const lng = searchParams.get('lng') ?? String(HYDERABAD.lng);
  const radius = searchParams.get('radius_km') ?? '5';
  const storage = searchParams.get('storage') ?? '';
  const category = searchParams.get('category') ?? '';
  const sort = (searchParams.get('sort') ?? 'nearest') as 'nearest' | 'ending_soon';
  const query = searchParams.get('q') ?? '';
  // Free-text search is debounced so typing does not fire a request per keystroke.
  const [searchText, setSearchText] = useState(query);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set('lat', lat);
    params.set('lng', lng);
    params.set('radius_km', radius);
    params.set('sort', sort);
    if (storage) params.set('storage', storage);
    if (category) params.set('category', category);
    if (query) params.set('q', query);
    return params.toString();
  }, [lat, lng, radius, storage, category, sort, query]);

  const { data, loading, error, reload } = useApiQuery<SearchResponse>(`/listings?${queryString}`);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText !== (searchParams.get('q') ?? '')) updateParam('q', searchText);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const center: [number, number] = [Number(lat), Number(lng)];
  const listings = data?.listings ?? [];

  return (
    <div>
      <PageHeader
        title="Browse surplus food nearby"
        subtitle="Radius, storage type and sort order are all applied server-side. Availability can change between refreshes."
        actions={
          <button type="button" className="fr-btn-secondary" onClick={() => setShowMap((value) => !value)}>
            {showMap ? 'Hide map' : 'Show map'}
          </button>
        }
      />

      <form
        className="fr-card mb-6 grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(event) => event.preventDefault()}
        aria-label="Search filters"
      >
        <Field label="Search text" htmlFor="q" hint="Matches title or description">
          <input
            id="q"
            className="fr-input"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="bread, biryani…"
          />
        </Field>
        <Field label="Latitude" htmlFor="lat">
          <input
            id="lat"
            className="fr-input"
            type="number"
            step="0.0001"
            value={lat}
            onChange={(event) => updateParam('lat', event.target.value)}
          />
        </Field>
        <Field label="Longitude" htmlFor="lng">
          <input
            id="lng"
            className="fr-input"
            type="number"
            step="0.0001"
            value={lng}
            onChange={(event) => updateParam('lng', event.target.value)}
          />
        </Field>
        <Field label="Radius (km)" htmlFor="radius_km" hint="Default 5 km, maximum 50 km">
          <input
            id="radius_km"
            className="fr-input"
            type="number"
            min="0.5"
            max="50"
            step="0.5"
            value={radius}
            onChange={(event) => updateParam('radius_km', event.target.value)}
          />
        </Field>
        <Field label="Storage" htmlFor="storage">
          <select
            id="storage"
            className="fr-input"
            value={storage}
            onChange={(event) => updateParam('storage', event.target.value)}
          >
            <option value="">Any storage</option>
            {(data?.availableStorage.length ? data.availableStorage : STORAGE_TYPES).map((option) => (
              <option key={option} value={option}>
                {humanizeEnum(option)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Sort by" htmlFor="sort">
          <select
            id="sort"
            className="fr-input"
            value={sort}
            onChange={(event) => updateParam('sort', event.target.value)}
          >
            <option value="nearest">Nearest first</option>
            <option value="ending_soon">Ending soonest</option>
          </select>
        </Field>
        <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-6">
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => {
              updateParam('lat', String(HYDERABAD.lat));
              updateParam('lng', String(HYDERABAD.lng));
            }}
          >
            Centre on Hyderabad
          </button>
          <button
            type="button"
            className="fr-btn-secondary"
            onClick={() => {
              setSearchText('');
              setSearchParams(new URLSearchParams({ sort }), { replace: true });
            }}
          >
            Clear filters
          </button>
          <span className="text-sm text-stone-600" aria-live="polite">
            {loading ? 'Searching…' : `${listings.length} listing${listings.length === 1 ? '' : 's'} in range`}
          </span>
        </div>
      </form>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {loading ? (
            <LoadingState label="Loading listings near you…" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} title="Could not load listings" />
          ) : listings.length === 0 ? (
            <EmptyState
              title="No listings in this area yet"
              description="Try widening the radius, clearing filters, or checking back later — providers post end-of-day surplus throughout the day."
              action={
                <button
                  type="button"
                  className="fr-btn-secondary"
                  onClick={() => {
                    updateParam('radius_km', '25');
                    updateParam('storage', '');
                  }}
                >
                  Widen to 25 km
                </button>
              }
            />
          ) : (
            <ul className="space-y-4">
              {listings.map((listing) => (
                <li key={listing.id}>
                  <ListingCard
                    listing={listing}
                    highlighted={activeId === listing.id}
                    onFocus={(item) => setActiveId(item.id)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {showMap ? (
          <div className="space-y-3 lg:col-span-2">
            <MapView
              listings={listings}
              center={center}
              radiusKm={Number(radius)}
              activeId={activeId}
              onSelect={(listing: PublicListing) => setActiveId(listing.id)}
              className="h-[420px] lg:h-[560px]"
            />
            <p className="text-xs text-stone-600">
              Markers are approximate (rounded to ~1 km). Exact pickup addresses are shared with the
              recipient organization once a reservation exists. Map data © OpenStreetMap contributors.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
