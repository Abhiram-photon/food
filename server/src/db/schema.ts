/**
 * Schema + migrations. Runs automatically on startup (and in tests) against
 * Node's built-in `node:sqlite` (synchronous API, no native build step).
 *
 * Timestamps are stored as ISO-8601 UTC strings so they compare lexicographically.
 */
import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  id: number;
  name: string;
  up: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'core',
    up: `
CREATE TABLE IF NOT EXISTS organizations (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL,                          -- BAKERY | GROCERY | CATERER | HOUSEHOLD | FOOD_BANK | CHARITY | SHELTER
  role          TEXT NOT NULL,                          -- PROVIDER | RECIPIENT | ADMIN
  status        TEXT NOT NULL DEFAULT 'PENDING',         -- PENDING | APPROVED | REJECTED
  contact_email TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  latitude      REAL,
  longitude     REAL,
  review_note   TEXT,
  reviewed_at   TEXT,
  reviewed_by   TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_organizations_status ON organizations(status, role);

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  role            TEXT NOT NULL,                         -- PROVIDER | RECIPIENT | ADMIN
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);

CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  csrf_token    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS listings (
  id                  TEXT PRIMARY KEY,
  provider_id         TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  title               TEXT NOT NULL,
  description         TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL,
  quantity            REAL NOT NULL,
  unit                TEXT NOT NULL,
  allergens           TEXT NOT NULL DEFAULT '',           -- comma list
  storage             TEXT NOT NULL,                      -- AMBIENT | CHILLED | FROZEN | HOT
  pickup_address      TEXT NOT NULL,
  latitude            REAL NOT NULL,
  longitude           REAL NOT NULL,
  window_start        TEXT NOT NULL,
  window_end          TEXT NOT NULL,
  expires_at          TEXT NOT NULL,
  pickup_instructions TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'DRAFT',      -- DRAFT | ACTIVE | PAUSED | RESERVED_OUT | EXPIRED | CANCELLED
  quantity_remaining  REAL NOT NULL,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_listings_provider ON listings(provider_id, status);
CREATE INDEX IF NOT EXISTS idx_listings_bbox ON listings(latitude, longitude, status);

CREATE TABLE IF NOT EXISTS reservations (
  id                TEXT PRIMARY KEY,
  listing_id        TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  recipient_id      TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by        TEXT REFERENCES users(id) ON DELETE SET NULL,
  quantity          REAL NOT NULL,
  unit              TEXT NOT NULL,
  pickup_start      TEXT NOT NULL,
  pickup_end        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'RESERVED',     -- RESERVED | COLLECTED | CANCELLED | EXPIRED
  code_hash         TEXT NOT NULL,
  code_encrypted    TEXT NOT NULL,
  code_attempts     INTEGER NOT NULL DEFAULT 0,
  locked_at         TEXT,
  collected_at      TEXT,
  cancelled_at      TEXT,
  cancelled_by      TEXT,                                 -- PROVIDER | RECIPIENT | ADMIN
  cancel_reason     TEXT,
  note              TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_listing ON reservations(listing_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_recipient ON reservations(recipient_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT,
  entity_id  TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, created_at);
`,
  },
];

export interface DbOptions {
  /** ':memory:' for tests, otherwise a file path. */
  path: string;
  verbose?: boolean;
}

export function openDatabase(options: DbOptions): DatabaseSync {
  const db = new DatabaseSync(options.path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 10000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  return db;
}

export function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map((r) => r.id),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.up);
      db.prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)').run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

export function openMigratedDatabase(options: DbOptions): DatabaseSync {
  const db = openDatabase(options);
  migrate(db);
  return db;
}
