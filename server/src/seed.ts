/**
 * `npm run seed` — wipes the database and rebuilds a realistic Hyderabad demo.
 *
 * Idempotent by design: every table is emptied first, so running it twice leaves
 * the same fixture data.
 */
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadConfig } from './config';
import { createDb, type Db } from './db';
import {
  encryptPickupCode,
  generatePickupCode,
  hashPassword,
  hashPickupCode,
  newId,
} from './lib/crypto';
import type { AppConfig } from './config';

const TABLES = ['notifications', 'reservations', 'listings', 'sessions', 'users', 'organizations'];

/** Empties every data table (schema_migrations is kept so versioning stays intact). */
function wipe(db: Db): void {
  for (const table of TABLES) {
    db.exec(`DELETE FROM ${table};`);
  }
}

interface SeededUser {
  id: string;
  email: string;
  role: string;
  organizationId: string | null;
}

interface SeedAccount {
  email: string;
  displayName: string;
  role: 'PROVIDER' | 'RECIPIENT' | 'ADMIN';
  organizationName: string | null;
  organizationType: string;
  orgStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  phone: string | null;
}

async function createAccount(db: Db, config: AppConfig, account: SeedAccount): Promise<SeededUser> {
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(config.demoPassword);
  const userId = newId();
  const organizationId = account.organizationName ? newId() : null;

  db.transaction(() => {
    if (organizationId && account.organizationName) {
      db.run(
        `INSERT INTO organizations
           (id, name, type, role, status, contact_email, phone, address, latitude, longitude,
            review_note, reviewed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          organizationId,
          account.organizationName,
          account.organizationType,
          account.role,
          account.orgStatus ?? 'APPROVED',
          account.email,
          account.phone,
          account.address,
          account.lat,
          account.lng,
          account.orgStatus === 'APPROVED' ? 'Verified by FreshRelay admin (seeded).' : null,
          account.orgStatus === 'APPROVED' ? now : null,
          now,
          now,
        ],
      );
    }
    db.run(
      `INSERT INTO users (id, organization_id, email, password_hash, display_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [userId, organizationId, account.email, passwordHash, account.displayName, account.role, now, now],
    );
  });

  return { id: userId, email: account.email, role: account.role, organizationId };
}

interface ListingSeed {
  providerIndex: 0 | 1 | 2;
  title: string;
  description: string;
  category: string;
  quantity: number;
  unit: string;
  allergens: string;
  storage: string;
  address: string;
  lat: number;
  lng: number;
  windowStartOffsetMinutes: number;
  windowEndOffsetMinutes: number;
  expiresOffsetMinutes?: number;
  status: string;
  quantityRemaining?: number;
  instructions: string;
}

const HYDERABAD = { lat: 17.385, lng: 78.4867 };

function insertListing(
  db: Db,
  providerId: string | null,
  authorId: string,
  seed: ListingSeed,
  now = new Date(),
): string {
  const id = newId();
  const start = new Date(now.getTime() + seed.windowStartOffsetMinutes * 60_000);
  const end = new Date(now.getTime() + seed.windowEndOffsetMinutes * 60_000);
  const expires = new Date(
    now.getTime() + (seed.expiresOffsetMinutes ?? seed.windowEndOffsetMinutes) * 60_000,
  );
  db.run(
    `INSERT INTO listings
       (id, provider_id, created_by, title, description, category, quantity, unit, allergens, storage,
        pickup_address, latitude, longitude, window_start, window_end, expires_at, pickup_instructions,
        status, quantity_remaining, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      providerId,
      authorId,
      seed.title,
      seed.description,
      seed.category,
      seed.quantity,
      seed.unit,
      seed.allergens,
      seed.storage,
      seed.address,
      seed.lat,
      seed.lng,
      start.toISOString(),
      end.toISOString(),
      expires.toISOString(),
      seed.instructions,
      seed.status,
      seed.quantityRemaining ?? seed.quantity,
      now.toISOString(),
      now.toISOString(),
    ],
  );
  return id;
}

interface ReservationSeed {
  listingId: string;
  recipientId: string;
  recipientUserId: string | null;
  quantity: number;
  unit: string;
  pickupStart: string;
  pickupEnd: string;
  status: 'RESERVED' | 'COLLECTED' | 'CANCELLED' | 'EXPIRED';
  collectedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  cancelledBy?: string | null;
  createdAt: string;
}

function insertReservation(db: Db, config: AppConfig, seed: ReservationSeed): string {
  const id = newId();
  const code = generatePickupCode();
  db.run(
    `INSERT INTO reservations
       (id, listing_id, recipient_id, created_by, quantity, unit, pickup_start, pickup_end, status,
        code_hash, code_encrypted, code_attempts, collected_at, cancelled_at, cancelled_by, cancel_reason,
        note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, '', ?, ?)`,
    [
      id,
      seed.listingId,
      seed.recipientId,
      seed.recipientUserId,
      seed.quantity,
      seed.unit,
      seed.pickupStart,
      seed.pickupEnd,
      seed.status,
      hashPickupCode(code, id, config.appSecret),
      encryptPickupCode(code, config.appSecret),
      seed.collectedAt ?? null,
      seed.cancelledAt ?? null,
      seed.cancelledBy ?? null,
      seed.cancelReason ?? null,
      seed.createdAt,
      seed.collectedAt ?? seed.cancelledAt ?? seed.createdAt,
    ],
  );
  return id;
}

function notify(
  db: Db,
  userId: string,
  type: string,
  title: string,
  body: string,
  link: string,
  createdAt: string,
): void {
  db.run(
    `INSERT INTO notifications (id, user_id, type, title, body, link, entity_id, read_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
    [newId(), userId, type, title, body, link, createdAt],
  );
}

async function main(): Promise<void> {
  const config = loadConfig();
  const databasePath =
    config.databasePath === ':memory:' ? ':memory:' : resolve(process.cwd(), config.databasePath);
  if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true });

  // Idempotent: drop the database file, recreate the schema, then load fixtures.
  if (databasePath !== ':memory:') {
    const { rmSync } = await import('node:fs');
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
  const db2 = createDb(databasePath);
  wipe(db2);

  const now = new Date();
  const minutes = (m: number) => new Date(now.getTime() + m * 60_000);
  const monthsAgo = (months: number, day = 12) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, day, 11, 30, 0));
    return d;
  };

  const admin = await createAccount(db2, config, {
    email: 'admin@freshrelay.dev',
    displayName: 'Asha Rao',
    role: 'ADMIN',
    organizationName: null,
    organizationType: 'OTHER',
    orgStatus: null,
    address: null,
    lat: null,
    lng: null,
    phone: null,
  });

  const bakery = await createAccount(db2, config, {
    email: 'bakery@freshrelay.dev',
    displayName: 'Imran Khan',
    role: 'PROVIDER',
    organizationName: 'Hyderabad Bakery Collective',
    organizationType: 'BAKERY',
    orgStatus: 'APPROVED',
    address: '12-2-417, Mehdipatnam Main Road, Hyderabad',
    lat: 17.3953,
    lng: 78.4378,
    phone: '+91 90000 11111',
  });

  const mart = await createAccount(db2, config, {
    email: 'grocery@freshrelay.dev',
    displayName: 'Lakshmi Reddy',
    role: 'PROVIDER',
    organizationName: 'Charminar Fresh Mart',
    organizationType: 'GROCERY',
    orgStatus: 'APPROVED',
    address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
    lat: 17.3616,
    lng: 78.4747,
    phone: '+91 90000 22222',
  });

  const caterer = await createAccount(db2, config, {
    email: 'caterer@freshrelay.dev',
    displayName: 'Ravi Teja',
    role: 'PROVIDER',
    organizationName: 'Deccan Caterers',
    organizationType: 'CATERER',
    orgStatus: 'PENDING',
    address: 'Plot 22, Gachibowli, Hyderabad',
    lat: 17.4401,
    lng: 78.3489,
    phone: '+91 90000 33333',
  });

  const foodBank = await createAccount(db2, config, {
    email: 'foodbank@freshrelay.dev',
    displayName: 'Priya Menon',
    role: 'RECIPIENT',
    organizationName: 'Akshaya Patra Kitchen',
    organizationType: 'FOOD_BANK',
    orgStatus: 'APPROVED',
    address: 'Kondapur, Hyderabad',
    lat: 17.4653,
    lng: 78.3607,
    phone: '+91 90000 44444',
  });

  const shelter = await createAccount(db2, config, {
    email: 'shelter@freshrelay.dev',
    displayName: 'Joseph Fernandes',
    role: 'RECIPIENT',
    organizationName: 'Sneha Shelter Trust',
    organizationType: 'SHELTER',
    orgStatus: 'APPROVED',
    address: 'Begumpet, Hyderabad',
    lat: 17.4435,
    lng: 78.4645,
    phone: '+91 90000 55555',
  });

  const charity = await createAccount(db2, config, {
    email: 'charity@freshrelay.dev',
    displayName: 'Nadia Sultana',
    role: 'RECIPIENT',
    organizationName: 'Helping Hands Charity',
    organizationType: 'CHARITY',
    orgStatus: 'PENDING',
    address: 'Tolichowki, Hyderabad',
    lat: 17.4009,
    lng: 78.4183,
    phone: '+91 90000 66666',
  });

  const providers = [bakery, mart, caterer];
  const providerIds = [bakery.organizationId, mart.organizationId, caterer.organizationId];

  // ---- 12 listings around Hyderabad ---------------------------------------
  const listingSeeds: ListingSeed[] = [
    {
      providerIndex: 0,
      title: 'Surplus bakery bread — 40 loaves',
      description:
        'Freshly baked sourdough and multigrain loaves from this morning’s batch. Unsold but perfect for tonight.',
      category: 'BAKERY',
      quantity: 40,
      unit: 'loaves',
      allergens: 'gluten',
      storage: 'AMBIENT',
      address: '12-2-417, Mehdipatnam Main Road, Hyderabad',
      lat: 17.3953,
      lng: 78.4378,
      windowStartOffsetMinutes: -30,
      windowEndOffsetMinutes: 180,
      status: 'ACTIVE',
      instructions: 'Enter via the bakery side gate. Ask for Imran at the dispatch counter.',
    },
    {
      providerIndex: 1,
      title: 'Fresh produce boxes (near end of shelf life)',
      description:
        'Tomatoes, okra, spinach and bananas that are cosmetically imperfect but fully usable today.',
      category: 'PRODUCE',
      quantity: 65,
      unit: 'kg',
      allergens: '',
      storage: 'CHILLED',
      address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
      lat: 17.3616,
      lng: 78.4747,
      windowStartOffsetMinutes: -60,
      windowEndOffsetMinutes: 90,
      status: 'ACTIVE',
      instructions: 'Cold room is at the back of the store. Bring crates.',
    },
    {
      providerIndex: 0,
      title: 'Catered veg biryani trays — 3 hrs left',
      description: 'Six full trays of vegetable biryani from an event. Kept at safe holding temperature.',
      category: 'PREPARED_MEALS',
      quantity: 18,
      unit: 'kg',
      allergens: 'nuts',
      storage: 'HOT',
      address: '12-2-417, Mehdipatnam Main Road, Hyderabad',
      lat: 17.3953,
      lng: 78.4378,
      windowStartOffsetMinutes: -120,
      windowEndOffsetMinutes: 45,
      status: 'ACTIVE',
      instructions: 'Insulated bags recommended. Kitchen door 2.',
    },
    {
      providerIndex: 1,
      title: 'Chilled paneer and yoghurt crates',
      description: 'Dairy reaching best-before tomorrow: paneer blocks, curd tubs, buttermilk packs.',
      category: 'DAIRY',
      quantity: 24,
      unit: 'kg',
      allergens: 'milk',
      storage: 'CHILLED',
      address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
      lat: 17.3616,
      lng: 78.4747,
      windowStartOffsetMinutes: -240,
      windowEndOffsetMinutes: 240,
      status: 'PAUSED',
      instructions: 'Provider paused this listing while stock is recounted.',
    },
    {
      providerIndex: 2,
      title: 'Wedding catering sandwiches (fully booked)',
      description: 'Assorted sandwiches from a wedding order. Every unit is already reserved.',
      category: 'PREPARED_MEALS',
      quantity: 30,
      unit: 'units',
      allergens: 'gluten, milk',
      storage: 'CHILLED',
      address: 'Plot 22, Gachibowli, Hyderabad',
      lat: 17.4401,
      lng: 78.3489,
      windowStartOffsetMinutes: -180,
      windowEndOffsetMinutes: 300,
      status: 'RESERVED_OUT',
      quantityRemaining: 0,
      instructions: 'Collection from the catering van at Gate 3.',
    },
    {
      providerIndex: 1,
      title: 'Near-expiry pantry staples',
      description: 'Rice, atta and lentils past their retail display date but well within safe use.',
      category: 'PANTRY',
      quantity: 120,
      unit: 'kg',
      allergens: '',
      storage: 'AMBIENT',
      address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
      lat: 17.3616,
      lng: 78.4747,
      windowStartOffsetMinutes: -30,
      windowEndOffsetMinutes: 600,
      status: 'ACTIVE',
      instructions: 'Loading bay on the north side. Trolley available.',
    },
    {
      providerIndex: 0,
      title: 'Festival mithai assortment (draft)',
      description: 'Draft listing — pending confirmation of the final quantity from the kitchen.',
      category: 'OTHER',
      quantity: 15,
      unit: 'boxes',
      allergens: 'milk, nuts',
      storage: 'AMBIENT',
      address: '12-2-417, Mehdipatnam Main Road, Hyderabad',
      lat: 17.3953,
      lng: 78.4378,
      windowStartOffsetMinutes: 60,
      windowEndOffsetMinutes: 480,
      status: 'DRAFT',
      instructions: 'Still being drafted by the provider.',
    },
    {
      providerIndex: 1,
      title: 'Yesterday’s fruit baskets (expired)',
      description: 'Fruit baskets that passed their pickup window and are no longer available.',
      category: 'PRODUCE',
      quantity: 20,
      unit: 'kg',
      allergens: '',
      storage: 'AMBIENT',
      address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
      lat: 17.3616,
      lng: 78.4747,
      windowStartOffsetMinutes: -720,
      windowEndOffsetMinutes: -420,
      status: 'EXPIRED',
      instructions: 'Window closed.',
    },
    {
      providerIndex: 0,
      title: 'Cancelled cake inventory',
      description: 'The provider cancelled this listing after the event was rescheduled.',
      category: 'BAKERY',
      quantity: 12,
      unit: 'boxes',
      allergens: 'gluten, milk, egg',
      storage: 'CHILLED',
      address: '12-2-417, Mehdipatnam Main Road, Hyderabad',
      lat: 17.3953,
      lng: 78.4378,
      windowStartOffsetMinutes: -120,
      windowEndOffsetMinutes: 240,
      status: 'CANCELLED',
      instructions: 'Listing cancelled by the provider.',
    },
    {
      providerIndex: 1,
      title: 'Frozen mixed vegetables',
      description: 'Frozen peas, corn and mixed veg from a broken freezer line — keep frozen in transit.',
      category: 'PRODUCE',
      quantity: 85,
      unit: 'kg',
      allergens: '',
      storage: 'FROZEN',
      address: 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
      lat: 17.3616,
      lng: 78.4747,
      windowStartOffsetMinutes: -45,
      windowEndOffsetMinutes: 300,
      status: 'ACTIVE',
      instructions: 'Freezer van required. Staff will load.',
    },
    {
      providerIndex: 0,
      title: 'Household surplus rice and dal',
      description: 'A family household donation: unopened 5 kg bags of rice and dal.',
      category: 'PANTRY',
      quantity: 35,
      unit: 'kg',
      allergens: '',
      storage: 'AMBIENT',
      address: 'Flat 302, Sai Residency, Attapur, Hyderabad',
      lat: 17.3666,
      lng: 78.4286,
      windowStartOffsetMinutes: -20,
      windowEndOffsetMinutes: 420,
      status: 'ACTIVE',
      instructions: 'Ring the bell at flat 302. Ground floor parking.',
    },
    {
      providerIndex: 2,
      title: 'Chilled curry and rotis — final call',
      description: 'Prepared curry and rotis expiring within the hour. Highest priority pickup.',
      category: 'PREPARED_MEALS',
      quantity: 14,
      unit: 'kg',
      allergens: 'gluten',
      storage: 'CHILLED',
      address: 'Plot 22, Gachibowli, Hyderabad',
      lat: 17.4401,
      lng: 78.3489,
      windowStartOffsetMinutes: -90,
      windowEndOffsetMinutes: 20,
      status: 'ACTIVE',
      instructions: 'Collect from the cold store, ask for the banquet chef.',
    },
  ];

  const listingIds = listingSeeds.map((seed) =>
    insertListing(db2, providerIds[seed.providerIndex] ?? null, providerIds[seed.providerIndex] ? providers[seed.providerIndex]!.id : admin.id, seed),
  );

  // ---- Historical listings + collected reservations for the impact chart ----
  const historicalCollected: Array<{ monthsBack: number; quantity: number; title: string }> = [
    { monthsBack: 3, quantity: 42, title: 'Historical: bakery surplus (3 months ago)' },
    { monthsBack: 2, quantity: 58, title: 'Historical: produce rescue (2 months ago)' },
    { monthsBack: 1, quantity: 76, title: 'Historical: catered meals (last month)' },
    { monthsBack: 1, quantity: 24, title: 'Historical: dairy rescue (last month)' },
    { monthsBack: 0, quantity: 31, title: 'Historical: this month rescue #1' },
    { monthsBack: 0, quantity: 27, title: 'Historical: this month rescue #2' },
  ];

  historicalCollected.forEach((entry, index) => {
    const when = monthsAgo(entry.monthsBack, 5 + index);
    const listingId = insertListing(
      db2,
      providerIds[index % 2] ?? null,
      (index % 2 === 0 ? bakery : mart).id,
      {
        providerIndex: (index % 2) as 0 | 1,
        title: entry.title,
        description: 'Completed rescue used to populate the monthly impact chart.',
        category: index % 3 === 0 ? 'BAKERY' : index % 3 === 1 ? 'PRODUCE' : 'PREPARED_MEALS',
        quantity: entry.quantity,
        unit: 'kg',
        allergens: '',
        storage: index % 2 === 0 ? 'AMBIENT' : 'CHILLED',
        address:
          index % 2 === 0
            ? '12-2-417, Mehdipatnam Main Road, Hyderabad'
            : 'Shop 4, Laad Bazaar Road, Charminar, Hyderabad',
        lat: index % 2 === 0 ? 17.3953 : 17.3616,
        lng: index % 2 === 0 ? 78.4378 : 78.4747,
        windowStartOffsetMinutes: -60,
        windowEndOffsetMinutes: 240,
        status: 'EXPIRED',
        instructions: '',
      },
      when,
    );
    const target = index % 2 === 0 ? foodBank : shelter;
    insertReservation(db2, config, {
      listingId,
      recipientId: target.organizationId!,
      recipientUserId: target.id,
      quantity: entry.quantity,
      unit: 'kg',
      pickupStart: when.toISOString(),
      pickupEnd: new Date(when.getTime() + 120 * 60_000).toISOString(),
      status: 'COLLECTED',
      collectedAt: when.toISOString(),
      createdAt: when.toISOString(),
    });
  });

  // ---- Live reservations ---------------------------------------------------
  const nowIso = now.toISOString();

  // Fully-reserved listing (index 4 = sandwiches) consumed by one recipient.
  insertReservation(db2, config, {
    listingId: listingIds[4]!,
    recipientId: foodBank.organizationId!,
    recipientUserId: foodBank.id,
    quantity: 30,
    unit: 'units',
    pickupStart: nowIso,
    pickupEnd: minutes(300).toISOString(),
    status: 'RESERVED',
    createdAt: minutes(-90).toISOString(),
  });

  // Partial reservation on the bread listing.
  const breadReservation = insertReservation(db2, config, {
    listingId: listingIds[0]!,
    recipientId: shelter.organizationId!,
    recipientUserId: shelter.id,
    quantity: 12,
    unit: 'loaves',
    pickupStart: nowIso,
    pickupEnd: minutes(180).toISOString(),
    status: 'RESERVED',
    createdAt: minutes(-20).toISOString(),
  });
  db2.run('UPDATE listings SET quantity_remaining = ? WHERE id = ?', [28, listingIds[0]!]);

  // Cancelled reservation with a reason, from a provider.
  insertReservation(db2, config, {
    listingId: listingIds[10]!,
    recipientId: foodBank.organizationId!,
    recipientUserId: foodBank.id,
    quantity: 10,
    unit: 'kg',
    pickupStart: nowIso,
    pickupEnd: minutes(420).toISOString(),
    status: 'CANCELLED',
    cancelledAt: minutes(-10).toISOString(),
    cancelledBy: 'PROVIDER',
    cancelReason: 'Recipient van broke down — stock returned to the shelf.',
    createdAt: minutes(-60).toISOString(),
  });

  // Expired reservation on an expired listing.
  insertReservation(db2, config, {
    listingId: listingIds[7]!,
    recipientId: shelter.organizationId!,
    recipientUserId: shelter.id,
    quantity: 20,
    unit: 'kg',
    pickupStart: minutes(-700).toISOString(),
    pickupEnd: minutes(-420).toISOString(),
    status: 'EXPIRED',
    createdAt: minutes(-800).toISOString(),
  });

  // Notifications so the bell is not empty on first login.
  notify(
    db2,
    bakery.id,
    'RESERVATION_CREATED',
    'New reservation: Surplus bakery bread — 40 loaves',
    'Sneha Shelter Trust reserved 12 loaves for pickup in the next 3 hours.',
    '/provider',
    minutes(-20).toISOString(),
  );
  notify(
    db2,
    bakery.id,
    'PICKUP_VERIFIED',
    'Pickup verified: Historical: bakery surplus (3 months ago)',
    '42 kg handed over and logged as rescued food.',
    '/provider',
    monthsAgo(3, 5).toISOString(),
  );
  notify(
    db2,
    shelter.id,
    'RESERVATION_CREATED',
    'Pickup code ready for Surplus bakery bread — 40 loaves',
    'Show the 6-digit code to the provider at pickup.',
    '/recipient',
    minutes(-20).toISOString(),
  );
  notify(
    db2,
    foodBank.id,
    'ORG_APPROVED',
    'Your organization was approved 🎉',
    'Akshaya Patra Kitchen is approved. You can now search and reserve surplus food.',
    '/recipient',
    monthsAgo(4, 2).toISOString(),
  );
  notify(
    db2,
    charity.id,
    'ORG_APPROVED',
    'Application received',
    'Helping Hands Charity is waiting for admin review.',
    '/recipient',
    minutes(-120).toISOString(),
  );
  notify(
    db2,
    admin.id,
    'ORG_APPROVED',
    '1 organization is waiting for review',
    'Deccan Caterers and Helping Hands Charity are pending admin approval.',
    '/admin',
    minutes(-30).toISOString(),
  );

  const reservationCount = Number(
    db2.get<{ count: number }>('SELECT COUNT(*) AS count FROM reservations')?.count ?? 0,
  );
  const listingCount = Number(
    db2.get<{ count: number }>('SELECT COUNT(*) AS count FROM listings')?.count ?? 0,
  );
  const orgCount = Number(
    db2.get<{ count: number }>('SELECT COUNT(*) AS count FROM organizations')?.count ?? 0,
  );
  const userCount = Number(
    db2.get<{ count: number }>('SELECT COUNT(*) AS count FROM users')?.count ?? 0,
  );

  const rows: Array<[string, string, string]> = [
    ['ADMIN', 'admin@freshrelay.dev', 'platform admin (no organization)'],
    ['PROVIDER (approved)', 'bakery@freshrelay.dev', 'Hyderabad Bakery Collective'],
    ['PROVIDER (approved)', 'grocery@freshrelay.dev', 'Charminar Fresh Mart'],
    ['PROVIDER (pending)', 'caterer@freshrelay.dev', 'Deccan Caterers — cannot publish yet'],
    ['RECIPIENT (approved)', 'foodbank@freshrelay.dev', 'Akshaya Patra Kitchen'],
    ['RECIPIENT (approved)', 'shelter@freshrelay.dev', 'Sneha Shelter Trust'],
    ['RECIPIENT (pending)', 'charity@freshrelay.dev', 'Helping Hands Charity — cannot reserve yet'],
  ];

  console.log('\n=== FreshRelay seed complete ===');
  console.log(`database: ${databasePath}`);
  console.log(
    `created: ${orgCount} organizations, ${userCount} accounts, ${listingCount} listings, ${reservationCount} reservations`,
  );
  console.log('\nDemo logins (LOCAL DEMO ONLY — every password is the same fake value):');
  console.log(`  password for all accounts: ${config.demoPassword}`);
  for (const [role, email, org] of rows) {
    console.log(`  - ${role.padEnd(20)} ${email.padEnd(26)} ${org}`);
  }
  console.log(
    `\nTip: sign in as shelter@freshrelay.dev to see the pickup code for the seeded bread reservation (${breadReservation.slice(0, 8)}…).`,
  );
  console.log('These credentials are for local demos only and must never be used in production.\n');

  db2.close();
}

main().catch((error) => {
  console.error('[seed] failed', error);
  process.exit(1);
});
