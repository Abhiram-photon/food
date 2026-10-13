import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, Popup, TileLayer, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { PublicListing } from '@shared';
import { humanizeEnum, formatQuantity } from '../lib/format';

/**
 * Leaflet map with OpenStreetMap tiles.
 *
 * Public listings only expose coordinates rounded to 2 decimals (~1 km), which is
 * exactly what we plot. Tiles are loaded from OSM by the user's own browser; if they
 * are blocked, the surrounding list view still works (a notice is shown instead).
 */
const DEFAULT_CENTER: [number, number] = [17.385, 78.4867];

const markerIcon = L.divIcon({
  className: 'fr-marker',
  html: `<span style="display:block;width:14px;height:14px;border-radius:9999px;background:#047857;border:2px solid #fff;box-shadow:0 0 0 2px rgba(4,120,87,0.35)"></span>`,
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

const centerIcon = L.divIcon({
  className: 'fr-marker-center',
  html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#1d4ed8;border:3px solid #fff;box-shadow:0 0 0 3px rgba(29,78,216,0.35)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function RecenterOnChange({ center, zoom }: { center: [number, number] | null; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    if (center) map.setView(center, zoom ?? map.getZoom());
  }, [center, zoom, map]);
  return null;
}

export interface MapViewProps {
  listings: PublicListing[];
  center: [number, number] | null;
  radiusKm?: number;
  activeId?: string | null;
  onSelect?: (listing: PublicListing) => void;
  className?: string;
}

export function MapView({
  listings,
  center,
  radiusKm,
  activeId,
  onSelect,
  className = 'h-[420px]',
}: MapViewProps) {
  const mapCenter = center ?? DEFAULT_CENTER;
  const markers = useMemo(
    () =>
      listings.map((listing) => ({
        listing,
        position: [listing.approximateLatitude, listing.approximateLongitude] as [number, number],
      })),
    [listings],
  );
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  useEffect(() => {
    if (!activeId) return;
    markerRefs.current[activeId]?.openPopup();
  }, [activeId]);

  return (
    <div className={`fr-card overflow-hidden ${className}`}>
      <MapContainer
        center={mapCenter}
        zoom={12}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%' }}
        attributionControl
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <RecenterOnChange center={center} />
        {center && radiusKm ? (
          <Circle
            center={center}
            radius={radiusKm * 1000}
            pathOptions={{ color: '#1d4ed8', fillOpacity: 0.05, weight: 1 }}
          />
        ) : null}
        {center ? <Marker position={center} icon={centerIcon} /> : null}
        {markers.map(({ listing, position }) => (
          <Marker
            key={listing.id}
            position={position}
            icon={markerIcon}
            ref={(instance) => {
              markerRefs.current[listing.id] = instance;
            }}
            eventHandlers={{ click: () => onSelect?.(listing) }}
          >
            <Popup>
              <strong>{listing.title}</strong>
              <br />
              {formatQuantity(listing.quantityRemaining)} {listing.unit} ·{' '}
              {humanizeEnum(listing.storage)}
              <br />
              <a href={`/listings/${listing.id}`}>Open listing</a>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
