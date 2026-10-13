/**
 * Central configuration. Everything has a safe default so the app runs with
 * `npm run seed && npm run dev` and zero environment setup.
 */
export type NodeEnv = 'development' | 'production' | 'test';

export interface AppConfig {
  nodeEnv: NodeEnv;
  port: number;
  host: string;
  /** Path to the SQLite file, or ':memory:' for an ephemeral database. */
  databasePath: string;
  sessionCookieName: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  /** Used to derive the AES-256-GCM key for pickup codes and to pepper code hashes. */
  appSecret: string;
  usingDefaultSecret: boolean;
  /** kg of food assumed per rescued meal (see docs/DECISIONS.md). */
  mealsKgPerMeal: number;
  searchDefaultRadiusKm: number;
  searchMaxRadiusKm: number;
  maxVerifyAttempts: number;
  sweepIntervalMs: number;
  logLevel: string;
  demoPassword: string;
}

export const DEFAULT_APP_SECRET = 'freshrelay-dev-only-secret-change-me';

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = (env.NODE_ENV ?? 'development') as NodeEnv;
  const appSecret = env.APP_SECRET?.trim() || DEFAULT_APP_SECRET;
  return {
    nodeEnv,
    port: num(env.PORT, 3001),
    host: env.HOST?.trim() || '0.0.0.0',
    databasePath: env.DATABASE_PATH?.trim() || 'data/freshrelay.db',
    sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'fr_session',
    sessionTtlHours: num(env.SESSION_TTL_HOURS, 24 * 30),
    cookieSecure: bool(env.COOKIE_SECURE, nodeEnv === 'production'),
    appSecret,
    usingDefaultSecret: appSecret === DEFAULT_APP_SECRET,
    mealsKgPerMeal: num(env.MEALS_KG_PER_MEAL, 0.4),
    searchDefaultRadiusKm: num(env.SEARCH_DEFAULT_RADIUS_KM, 5),
    searchMaxRadiusKm: num(env.SEARCH_MAX_RADIUS_KM, 50),
    maxVerifyAttempts: num(env.MAX_VERIFY_ATTEMPTS, 5),
    sweepIntervalMs: num(env.SWEEP_INTERVAL_MS, 60_000),
    logLevel: env.LOG_LEVEL?.trim() || (nodeEnv === 'test' ? 'silent' : 'info'),
    demoPassword: env.DEMO_PASSWORD?.trim() || 'Password123!',
  };
}
