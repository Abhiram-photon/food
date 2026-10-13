/**
 * Test harness: builds a Fastify app on an in-memory SQLite database.
 * Everything runs through `app.inject`, so no port is bound and no browser is needed.
 */
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { loadConfig, type AppConfig } from '../config';
import { createDb, type Db } from '../db';
import { MemoryEmailSender } from '../emails/sender';
import { decryptPickupCode, digest, hashPassword, newId, randomToken } from '../lib/crypto';
import type { Role } from '../schemas/common';

export interface TestHarness {
  app: FastifyInstance;
  db: Db;
  config: AppConfig;
  emailSender: MemoryEmailSender;
  close: () => Promise<void>;
}

export async function createTestHarness(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): Promise<TestHarness> {
  const config = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_PATH: ':memory:',
    APP_SECRET: 'test-secret',
    DEMO_PASSWORD: 'Password123!',
    ...overrides,
  });
  const db = createDb(':memory:');
  const emailSender = new MemoryEmailSender();
  const bundle = await buildApp({ db, config, emailSender, logger: false, sweepIntervalMs: 0 });
  return {
    app: bundle.app,
    db,
    config,
    emailSender,
    close: async () => {
      await bundle.close();
      db.close();
    },
  };
}

export const CSRF_HEADERS = { 'x-requested-with': 'FreshRelayTest' } as const;

export interface TestUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  organizationName: string | null;
  cookie: string;
  csrfToken: string;
  password: string;
}

/** Inserts a session row and returns the cookie + csrf token for injecting requests. */
export function startSession(
  db: Db,
  userId: string,
  ttlHours = 24,
): { cookie: string; csrfToken: string } {
  const token = randomToken(24);
  const csrfToken = randomToken(16);
  db.run(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_token, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      userId,
      digest(token),
      csrfToken,
      new Date(Date.now() + ttlHours * 3600_000).toISOString(),
      new Date().toISOString(),
    ],
  );
  return { cookie: `fr_session=${token}`, csrfToken };
}

interface CreateUserOptions {
  role: Role;
  email: string;
  password?: string;
  displayName?: string;
  organizationName?: string;
  organizationType?: string;
  orgStatus?: 'PENDING' | 'APPROVED' | 'REJECTED' | null;
  latitude?: number;
  longitude?: number;
  address?: string;
}

/** Creates an organization + user directly in the database (fast, no HTTP round trip). */
export async function createUser(db: Db, options: CreateUserOptions): Promise<TestUser> {
  const password = options.password ?? 'Password123!';
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  const organizationId = options.orgStatus === null || options.role === 'ADMIN' ? null : newId();
  const userId = newId();

  if (organizationId) {
    db.run(
      `INSERT INTO organizations
        (id, name, type, role, status, contact_email, phone, address, latitude, longitude, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        organizationId,
        options.organizationName ?? `${options.role} org ${userId.slice(0, 6)}`,
        options.organizationType ?? (options.role === 'PROVIDER' ? 'BAKERY' : 'FOOD_BANK'),
        options.role,
        options.orgStatus ?? 'APPROVED',
        options.email,
        options.address ?? null,
        options.latitude ?? null,
        options.longitude ?? null,
        now,
        now,
      ],
    );
  }

  db.run(
    `INSERT INTO users (id, organization_id, email, password_hash, display_name, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [
      userId,
      organizationId,
      options.email,
      passwordHash,
      options.displayName ?? options.email.split('@')[0]!,
      options.role,
      now,
      now,
    ],
  );

  const session = startSession(db, userId);
  return {
    id: userId,
    email: options.email,
    role: options.role,
    organizationId,
    organizationName: options.organizationName ?? null,
    cookie: session.cookie,
    csrfToken: session.csrfToken,
    password,
  };
}

export interface InjectOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  payload?: unknown;
  cookie?: string;
  csrfToken?: string;
  headers?: Record<string, string>;
}

/** Injects a request, adding the CSRF header for mutating methods by default. */
export async function inject(
  app: FastifyInstance,
  options: InjectOptions,
): Promise<{ status: number; body: any; headers: Record<string, unknown> }> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { ...options.headers };
  if (options.cookie) headers.cookie = options.cookie;
  if (method !== 'GET') {
    headers['x-requested-with'] = headers['x-requested-with'] ?? 'FreshRelay';
    if (options.csrfToken) headers['x-csrf-token'] = options.csrfToken;
  }
  const response = await app.inject({
    method,
    url: options.url,
    headers,
    payload: options.payload as never,
  });
  let body: unknown = response.body;
  try {
    body = response.json();
  } catch {
    /* non-JSON response (e.g. plain text 404) */
  }
  return { status: response.statusCode, body, headers: response.headers };
}

export interface ListingFixture {
  id: string;
  providerId: string;
}

export interface ListingFixtureOptions {
  providerId: string;
  createdBy?: string;
  title?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  storage?: string;
  status?: string;
  quantityRemaining?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  windowStart?: Date;
  windowEnd?: Date;
  expiresAt?: Date;
}

export function createListingFixture(db: Db, options: ListingFixtureOptions): ListingFixture {
  const now = new Date();
  const id = newId();
  const windowStart = options.windowStart ?? new Date(now.getTime() - 5 * 60_000);
  const windowEnd = options.windowEnd ?? new Date(now.getTime() + 120 * 60_000);
  const expiresAt = options.expiresAt ?? windowEnd;
  db.run(
    `INSERT INTO listings
      (id, provider_id, created_by, title, description, category, quantity, unit, allergens, storage,
       pickup_address, latitude, longitude, window_start, window_end, expires_at, pickup_instructions,
       status, quantity_remaining, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'test description', ?, ?, ?, 'gluten', ?, ?, ?, ?, ?, ?, ?, 'Ring the bell',
             ?, ?, ?, ?)`,
    [
      id,
      options.providerId,
      options.createdBy ?? null,
      options.title ?? 'Test surplus listing',
      options.category ?? 'BAKERY',
      options.quantity ?? 10,
      options.unit ?? 'kg',
      options.storage ?? 'AMBIENT',
      options.address ?? '1 Test Street, Hyderabad',
      options.latitude ?? 17.385,
      options.longitude ?? 78.4867,
      windowStart.toISOString(),
      windowEnd.toISOString(),
      expiresAt.toISOString(),
      options.status ?? 'ACTIVE',
      options.quantityRemaining ?? options.quantity ?? 10,
      now.toISOString(),
      now.toISOString(),
    ],
  );
  return { id, providerId: options.providerId };
}

/** Directly sets a reservation's pickup window (used to test code timing rules). */
export function setReservationWindow(
  db: Db,
  reservationId: string,
  pickupStart: Date,
  pickupEnd: Date,
): void {
  db.run('UPDATE reservations SET pickup_start = ?, pickup_end = ?, updated_at = ? WHERE id = ?', [
    pickupStart.toISOString(),
    pickupEnd.toISOString(),
    new Date().toISOString(),
    reservationId,
  ]);
}

/** Reads a reservation's pickup code (server-side only; the API never leaks hashes). */
export function getReservationCode(db: Db, config: AppConfig, reservationId: string): string {
  const row = db.get<{ code_encrypted: string }>(
    'SELECT code_encrypted FROM reservations WHERE id = ?',
    [reservationId],
  );
  if (!row) throw new Error('reservation not found');
  const code = decryptPickupCode(row.code_encrypted, config.appSecret);
  if (!code) throw new Error('pickup code could not be decrypted');
  return code;
}
