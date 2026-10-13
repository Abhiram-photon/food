import type { AppConfig } from '../config';
import { Db } from '../db';
import { monthKey, recentMonthKeys } from '../lib/time';
import type { ImpactStats } from '../schemas/reservations';
import type { SessionUser } from './auth';

export interface ImpactContext {
  db: Db;
  config: AppConfig;
}

interface CollectedRow {
  id: string;
  quantity: number;
  unit: string;
  collected_at: string | null;
  listing_id: string;
  listing_title: string;
  category: string;
  storage: string;
  provider_name: string;
  recipient_name: string;
}

const KG_UNITS = new Set(['kg', 'kgs', 'kilogram', 'kilograms', 'kilo', 'kilos']);

function isKg(unit: string): boolean {
  return KG_UNITS.has(unit.trim().toLowerCase());
}

export function mealsEstimate(kg: number, config: AppConfig): number {
  const factor = config.mealsKgPerMeal > 0 ? config.mealsKgPerMeal : 0.4;
  return Math.round((kg / factor) * 10) / 10;
}

function round(value: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

interface CollectedQuery {
  sql: string;
  params: unknown[];
}

function collectedQuery(
  scope: 'platform' | 'provider' | 'recipient',
  organizationId?: string,
): CollectedQuery {
  const base = `
    SELECT r.id, r.quantity, r.unit, r.collected_at, r.listing_id,
           l.title AS listing_title, l.category, l.storage,
           p.name AS provider_name, rec.name AS recipient_name
    FROM reservations r
    JOIN listings l ON l.id = r.listing_id
    JOIN organizations p ON p.id = l.provider_id
    JOIN organizations rec ON rec.id = r.recipient_id
    WHERE r.status = 'COLLECTED'`;
  if (scope === 'provider') {
    return {
      sql: `${base} AND l.provider_id = ? ORDER BY r.collected_at DESC`,
      params: [organizationId],
    };
  }
  if (scope === 'recipient') {
    return {
      sql: `${base} AND r.recipient_id = ? ORDER BY r.collected_at DESC`,
      params: [organizationId],
    };
  }
  return { sql: `${base} ORDER BY r.collected_at DESC`, params: [] };
}

/**
 * Impact is computed ONLY from COLLECTED reservations.
 * "kg" is exact for rows recorded in kg; other units are summed separately so the
 * platform total is never silently inflated by mixing units (see DECISIONS.md).
 */
export function buildImpactStats(ctx: ImpactContext, actor: SessionUser): ImpactStats {
  const { db, config } = ctx;
  const role = actor.user.role;
  const scope: ImpactStats['scope'] =
    role === 'ADMIN' ? 'admin' : role === 'PROVIDER' ? 'provider' : 'recipient';
  const organizationId = actor.organization?.id;

  const query = collectedQuery(scope === 'admin' ? 'platform' : scope, organizationId);
  const rows = db.all<CollectedRow>(query.sql, query.params);

  let quantity = 0;
  let kg = 0;
  let unitFreeQuantity = 0;
  for (const row of rows) {
    quantity += row.quantity;
    if (isKg(row.unit)) kg += row.quantity;
    else unitFreeQuantity += row.quantity;
  }

  const months = recentMonthKeys(6);
  const monthlyMap = new Map(months.map((month) => [month, { pickups: 0, kg: 0, quantity: 0 }]));
  for (const row of rows) {
    if (!row.collected_at) continue;
    const key = monthKey(row.collected_at);
    const bucket = monthlyMap.get(key);
    if (!bucket) continue;
    bucket.pickups += 1;
    bucket.quantity += row.quantity;
    if (isKg(row.unit)) bucket.kg += row.quantity;
  }

  const byStorage = new Map<string, { pickups: number; quantity: number; kg: number }>();
  const byCategory = new Map<string, { pickups: number; quantity: number; kg: number }>();
  for (const row of rows) {
    const storage = byStorage.get(row.storage) ?? { pickups: 0, quantity: 0, kg: 0 };
    storage.pickups += 1;
    storage.quantity += row.quantity;
    if (isKg(row.unit)) storage.kg += row.quantity;
    byStorage.set(row.storage, storage);

    const category = byCategory.get(row.category) ?? { pickups: 0, quantity: 0, kg: 0 };
    category.pickups += 1;
    category.quantity += row.quantity;
    if (isKg(row.unit)) category.kg += row.quantity;
    byCategory.set(row.category, category);
  }

  const scopeWhere =
    scope === 'provider' ? 'WHERE provider_id = ?' : scope === 'recipient' ? 'WHERE 1 = 0' : '';
  const listingCounts =
    scope === 'provider'
      ? db.get<{ total: number; active: number; reserved: number }>(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                  SUM(CASE WHEN status = 'RESERVED_OUT' THEN 1 ELSE 0 END) AS reserved
             FROM listings ${scopeWhere}`,
          [organizationId],
        )
      : scope === 'recipient'
        ? db.get<{ total: number; active: number; reserved: number }>(
            `SELECT COUNT(DISTINCT l.id) AS total,
                    SUM(CASE WHEN l.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN l.status = 'RESERVED_OUT' THEN 1 ELSE 0 END) AS reserved
               FROM listings l JOIN reservations r ON r.listing_id = l.id
              WHERE r.recipient_id = ?`,
            [organizationId],
          )
        : db.get<{ total: number; active: number; reserved: number }>(
            `SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN status = 'RESERVED_OUT' THEN 1 ELSE 0 END) AS reserved
               FROM listings`,
          );

  const pendingReservations =
    scope === 'provider'
      ? Number(
          db.get<{ count: number }>(
            `SELECT COUNT(*) AS count FROM reservations r JOIN listings l ON l.id = r.listing_id
              WHERE l.provider_id = ? AND r.status = 'RESERVED'`,
            [organizationId],
          )?.count ?? 0,
        )
      : scope === 'recipient'
        ? Number(
            db.get<{ count: number }>(
              `SELECT COUNT(*) AS count FROM reservations WHERE recipient_id = ? AND status = 'RESERVED'`,
              [organizationId],
            )?.count ?? 0,
          )
        : Number(
            db.get<{ count: number }>(
              `SELECT COUNT(*) AS count FROM reservations WHERE status = 'RESERVED'`,
            )?.count ?? 0,
          );

  const kgRounded = round(kg, 2);
  return {
    scope,
    totals: {
      pickups: rows.length,
      quantity: round(quantity, 2),
      kg: kgRounded,
      unitFreeQuantity: round(unitFreeQuantity, 2),
      listings: Number(listingCounts?.total ?? 0),
      activeListings: Number(listingCounts?.active ?? 0),
      reservedListings: Number(listingCounts?.reserved ?? 0),
      pendingReservations,
    },
    meals: {
      estimate: mealsEstimate(kgRounded, config),
      kgPerMeal: config.mealsKgPerMeal,
      formula: `meals = rescued kg ÷ ${config.mealsKgPerMeal}`,
      note: `Meals are estimated using the assumption that one meal weighs about ${config.mealsKgPerMeal} kg (meals = rescued kg / ${config.mealsKgPerMeal}). This is an estimate, not a measured figure.`,
    },
    monthly: months.map((month) => {
      const bucket = monthlyMap.get(month)!;
      return {
        month,
        pickups: bucket.pickups,
        quantity: round(bucket.quantity, 2),
        kg: round(bucket.kg, 2),
        meals: mealsEstimate(bucket.kg, config),
      };
    }),
    byStorage: [...byStorage.entries()].map(([key, value]) => ({
      key,
      label: key,
      pickups: value.pickups,
      quantity: round(value.quantity, 2),
      kg: round(value.kg, 2),
    })),
    byCategory: [...byCategory.entries()].map(([key, value]) => ({
      key,
      label: key,
      pickups: value.pickups,
      quantity: round(value.quantity, 2),
      kg: round(value.kg, 2),
    })),
    recentPickups: rows.slice(0, 10).map((row) => ({
      id: row.id,
      listingTitle: row.listing_title,
      quantity: row.quantity,
      unit: row.unit,
      collectedAt: row.collected_at,
      providerName: row.provider_name,
      recipientName: row.recipient_name,
    })),
  };
}

export { isKg };
