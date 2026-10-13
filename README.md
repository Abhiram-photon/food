# FreshRelay

**FreshRelay connects food providers that have surplus food with the recipient organizations that need it.**
A bakery lists 40 unsold loaves with a pickup window; a food bank 2 km away reserves 12 of them, shows a
6-digit code at collection, and only then do those loaves count as rescued food on the impact dashboard.

The problem is real and quantified: UNEP's *Food Waste Index Report 2024* estimates that **1.05 billion
tonnes of food were wasted in 2022** across households, food service and retail — roughly 132 kg per person,
or almost a fifth of all food available to consumers. FreshRelay is the small piece of logistics that
recovers some of it before it expires.

---

## Quick start

```bash
npm install     # 1. install workspaces (server + client)
npm run seed    # 2. create + populate the SQLite demo database (idempotent)
npm run dev     # 3. start API (:3001) and web client (:5173) together
npm test        # 4. run the server + client test suites
```

Open **http://localhost:5173**. The browser only ever talks to the Vite origin — `/api/*` is proxied to the
Fastify server, so there is no CORS setup and no absolute API URL anywhere in the client.

Other useful scripts: `npm run typecheck`, `npm run build`, `npm start` (serve the built bundle + API),
`npm run lint`, `npm run format`, `npm run test:server`, `npm run test:client`.

## Demo accounts

`npm run seed` prints these; the password is the same for every account (local demo only — never reuse it).

| Role | Email | Organization | Notes |
| --- | --- | --- | --- |
| Admin | `admin@freshrelay.dev` | — | approves/rejects organizations, sees platform totals |
| Provider (approved) | `bakery@freshrelay.dev` | Hyderabad Bakery Collective | publishes listings, verifies pickup codes |
| Provider (approved) | `grocery@freshrelay.dev` | Charminar Fresh Mart | 5 live listings around Hyderabad |
| Provider (pending) | `caterer@freshrelay.dev` | Deccan Caterers | can save drafts, cannot publish |
| Recipient (approved) | `foodbank@freshrelay.dev` | Akshaya Patra Kitchen | reserves food, has collected history |
| Recipient (approved) | `shelter@freshrelay.dev` | Sneha Shelter Trust | holds a live reservation with a code |
| Recipient (pending) | `charity@freshrelay.dev` | Helping Hands Charity | cannot reserve until approved |

Password: **`Password123!`** (`DEMO_PASSWORD` to change it). The seed wipes and rebuilds the database on
every run, and leaves the pending organizations in place so the admin flow can be demonstrated.

## Architecture

```
                      browser (same origin, no CORS)
  ┌─────────────────────────────────────────────────────────────────────┐
  │  React 19 + TypeScript SPA (Vite)        React Router · Tailwind v4 │
  │  pages: / /register /login /browse /listings/:id /provider          │
  │         /recipient /impact /admin      Leaflet + OSM tiles (map)    │
  └───────────────────────────────▲─────────────────────────────────────┘
                                  │ fetch('/api/…')  X-Requested-With + httpOnly cookie
  ┌───────────────────────────────┴─────────────────────────────────────┐
  │  Vite dev server :5173  ──proxy /api──▶  Fastify API :3001          │
  └─────────────────────────────────────────────────────────────────────┘
                                  │
  ┌───────────────────────────────▼─────────────────────────────────────┐
  │  Fastify 5 + Zod 4                                                  │
  │   routes/  auth · listings · reservations · notifications ·         │
  │            admin · impact · meta                                    │
  │   services/ auth (scrypt+sessions) · listings (status,search) ·     │
  │            reservations (stock, codes) · impact · admin             │
  │   schemas/ shared Zod contracts  ◀── imported by the client (@shared)│
  │   emails/  EmailSender interface + ConsoleEmailSender (deferred)    │
  └───────────────────────────────┬─────────────────────────────────────┘
                                  │ node:sqlite (synchronous, BEGIN IMMEDIATE)
  ┌───────────────────────────────▼─────────────────────────────────────┐
  │  SQLite file server/data/freshrelay.db                              │
  │   organizations · users · sessions · listings · reservations ·      │
  │   notifications        (schema created/migrated on startup)         │
  └─────────────────────────────────────────────────────────────────────┘
```

Key behaviours:

- **Statuses are computed on read** *and* swept (per request, throttled to 1/s, plus a 60-second timer),
  so an expired listing can never be served as `ACTIVE`.
- **Stock changes inside `BEGIN IMMEDIATE`** — 20 simultaneous reservation requests for 5 units produce
  exactly 5 reservations and a `RESERVED_OUT` listing (there is a test for it).
- **Public listings expose coordinates rounded to 2 decimals (~1 km)**; the exact address unlocks for the
  reservoir (and the owner) only.
- **Pickup codes**: only a salted HMAC-SHA256 hash and an AES-256-GCM ciphertext are stored; the provider
  never sees the code, verification is valid only inside the pickup window, single-use, and the
  reservation locks after 5 wrong attempts.
- **Impact counts only `COLLECTED` reservations**, reports kg separately from non-kg units, and estimates
  meals as `rescued kg / 0.4` — labelled as an estimate with the formula shown.

## Environment variables

Everything is optional locally; see `.env.example` for the annotated list.

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` / `production` / `test` |
| `PORT` | `3001` | API port |
| `HOST` | `0.0.0.0` | API bind address (kept at `0.0.0.0` so preview proxies can reach it) |
| `DATABASE_PATH` | `data/freshrelay.db` | SQLite file (relative to `server/`) or `:memory:` |
| `APP_SECRET` | dev-only default | encrypts pickup codes, peppers their hashes, signs cookies. **Set this in production** — the server refuses to boot in production with the default. |
| `SESSION_COOKIE_NAME` | `fr_session` | session cookie name |
| `SESSION_TTL_HOURS` | `720` | session lifetime |
| `COOKIE_SECURE` | `false` (`true` in production) | mark the cookie `Secure` behind HTTPS |
| `MEALS_KG_PER_MEAL` | `0.4` | meals estimate factor (`meals = rescued kg / factor`) |
| `SEARCH_DEFAULT_RADIUS_KM` | `5` | default search radius |
| `SEARCH_MAX_RADIUS_KM` | `50` | hard cap on the search radius |
| `MAX_VERIFY_ATTEMPTS` | `5` | wrong codes before a reservation is locked |
| `SWEEP_INTERVAL_MS` | `60000` | background status-sweep interval |
| `DEMO_PASSWORD` | `Password123!` | password for every seeded demo account |
| `LOG_LEVEL` | `info` (`silent` in tests) | Fastify/pino log level |
| `CLIENT_PORT` | `5173` | Vite dev-server port |
| `API_TARGET` | `http://127.0.0.1:3001` | where Vite proxies `/api` |

## Tests

```bash
npm test              # everything (server then client)
npm run test:server   # Vitest + Fastify inject, in-memory SQLite
npm run test:client   # Vitest + jsdom + Testing Library
```

No browser, no Docker, no external service is required. Coverage highlights:

- password hashing/verification and the full login/logout/session/CSRF flow
- role guards (recipient cannot create listings, provider cannot reserve), 404s for other people's
  listings and reservations, pending organizations blocked from publishing/reserving
- listing lifecycle, expiry sweeping, privacy of exact addresses, radius search ordering
- reservation validation (over-quantity, after the window), stock restore on cancel, provider cancel reason
- **concurrency**: 20 parallel reservations for 5 units → exactly 5 succeed, listing ends `RESERVED_OUT`
- pickup codes: salting, single use, 5-attempt lock, wrong-time rejection, cross-provider 404
- impact scoping (only `COLLECTED` counts), admin approve/reject, notification read flow
- client: countdown tones, listing cards, chart, and a route-level smoke test of every page

Playwright is intentionally not used — browsers cannot be downloaded in this environment (see
`docs/DECISIONS.md` §8).

## Repository layout

```
.
├── server/                  Fastify API + SQLite
│   ├── src/db/              schema, migrations, Db wrapper (BEGIN IMMEDIATE helper)
│   ├── src/services/        auth, listings, reservations, impact, notifications, admin
│   ├── src/routes/          HTTP layer (Zod-validated, thin)
│   ├── src/schemas/         shared Zod contracts + API types  ← also imported by the client
│   ├── src/emails/          EmailSender interface + console implementation
│   ├── src/tests/           Vitest suites + test harness
│   └── src/seed.ts          `npm run seed`
├── client/                  React + Vite + Tailwind + Leaflet
│   └── src/{pages,components,api,state,tests}
├── docs/DECISIONS.md        every choice, assumption and deferred feature
├── PROGRESS.md              phase-by-phase checklist
└── .env.example
```

## Known limitations

- **Single process assumed.** Sessions and the status sweep live in-process/DB; running multiple API
  instances would work for reads but needs a real job runner for scheduled work.
- **No email, password reset or background jobs.** `EmailSender` is console-only; "email is deferred" is a
  documented v1 boundary, not an oversight.
- **6-digit codes are shown as text, never scanned.** QR/proof-of-pickup photos are out of scope.
- **Search is capped** at 500 candidate listings per query, with no pagination — fine for a city-scale
  pilot, not for a national rollout.
- **Units are free text.** Only kg-family units contribute to kg totals and the meals estimate; other units
  are reported separately on purpose.
- **No real-time updates.** Listings, reservations and the notification bell refresh by polling/reload, so
  two recipients can race for the last box without the UI updating live (the server still arbitrates
  correctly — the loser sees a clear "fully reserved" message).
- **Admin tooling is minimal**: approve/reject plus platform totals. There is no user management screen,
  and a locked reservation can only be unlocked with direct database access.
- **Map tiles come from OpenStreetMap** and are loaded by the browser; if the network blocks them you get
  an empty map area but the list view remains fully functional.
- **Dev-only defaults.** `APP_SECRET` and the demo password are for local demos; production enforces a real
  secret but you must supply one.
