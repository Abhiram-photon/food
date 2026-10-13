import type { FastifyInstance } from 'fastify';
import { requireUser, type AppContext } from '../http/context';
import { buildImpactStats } from '../services/impact';

export function registerImpactRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { db, config } = ctx;

  /** Role-scoped impact: platform-wide for admins, provider/recipient scoped otherwise. */
  app.get('/api/impact', async (request) => {
    const sessionUser = requireUser(request);
    return buildImpactStats({ db, config }, sessionUser);
  });

  /** Public headline numbers for the landing page (aggregate, no private data). */
  app.get('/api/impact/public', async () => {
    const row = db.get<{ pickups: number; kg: number; providers: number; recipients: number }>(
      `SELECT
         (SELECT COUNT(*) FROM reservations WHERE status = 'COLLECTED') AS pickups,
         (SELECT COALESCE(SUM(quantity), 0) FROM reservations
           WHERE status = 'COLLECTED'
             AND LOWER(TRIM(unit)) IN ('kg','kgs','kilogram','kilograms','kilo','kilos')) AS kg,
         (SELECT COUNT(*) FROM organizations WHERE role = 'PROVIDER' AND status = 'APPROVED') AS providers,
         (SELECT COUNT(*) FROM organizations WHERE role = 'RECIPIENT' AND status = 'APPROVED') AS recipients`,
    );
    const kg = Number(row?.kg ?? 0);
    return {
      pickups: Number(row?.pickups ?? 0),
      kg: Math.round(kg * 100) / 100,
      mealsEstimate: Math.round((kg / config.mealsKgPerMeal) * 10) / 10,
      kgPerMeal: config.mealsKgPerMeal,
      approvedProviders: Number(row?.providers ?? 0),
      approvedRecipients: Number(row?.recipients ?? 0),
      activeListings: Number(
        db.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM listings WHERE status = 'ACTIVE' AND expires_at > ?`,
          [new Date().toISOString()],
        )?.count ?? 0,
      ),
    };
  });
}
