import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../http/context';
import {
  CATEGORIES,
  ORG_TYPES,
  PROVIDER_ORG_TYPES,
  RECIPIENT_ORG_TYPES,
  STORAGE_TYPES,
  UNIT_SUGGESTIONS,
} from '../schemas/common';

export function registerMetaRoutes(app: FastifyInstance, ctx: AppContext): void {
  const { config } = ctx;

  app.get('/api/health', async () => ({ ok: true, uptimeSeconds: Math.round(process.uptime()) }));

  /**
   * Client bootstrap: enums and tunables that the UI needs so the client never
   * hard-codes server constants.
   */
  app.get('/api/config', async () => ({
    storageTypes: STORAGE_TYPES,
    categories: CATEGORIES,
    orgTypes: ORG_TYPES,
    providerOrgTypes: PROVIDER_ORG_TYPES,
    recipientOrgTypes: RECIPIENT_ORG_TYPES,
    unitSuggestions: UNIT_SUGGESTIONS,
    search: {
      defaultRadiusKm: config.searchDefaultRadiusKm,
      maxRadiusKm: config.searchMaxRadiusKm,
    },
    reservations: { maxVerifyAttempts: config.maxVerifyAttempts },
    impact: {
      kgPerMeal: config.mealsKgPerMeal,
      formula: `meals = rescued kg / ${config.mealsKgPerMeal}`,
    },
  }));

  /** UNEP reference used on the landing page. */
  app.get('/api/facts', async () => ({
    headline: '1.05 billion tonnes of food were wasted in 2022',
    source: 'UNEP Food Waste Index Report 2024',
    sourceUrl: 'https://www.unep.org/resources/publication/food-waste-index-report-2024',
    detail:
      'UNEP estimates that 1.05 billion tonnes of food were wasted in 2022 across households, food service and retail. That is roughly 132 kg per person, or almost a fifth of all food available to consumers.',
  }));
}
