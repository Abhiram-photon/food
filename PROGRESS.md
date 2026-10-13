# FreshRelay — build progress

Resume-friendly checklist. Each phase ends with a green run of `npm test`, `npm run typecheck`
(and later `npm run build`), plus a commit.

Status legend: `[x]` done · `[~]` in progress · `[ ]` not started

## P0 — Scaffold

- [x] npm workspaces monorepo (`server/`, `client/`) + root scripts
- [x] TypeScript configs (base + per-workspace), Node 22 target
- [x] ESLint (flat config) + Prettier
- [x] Vitest configured on both sides; empty run passes
- [x] `npm run dev` runs API + Vite via `concurrently`
- [x] .gitignore / .env.example / PROGRESS.md

## P1 — Database + seed

- [x] `node:sqlite` (`DatabaseSync`) chosen — no native build step needed
- [x] Schema + migration runner executed on startup (`db/schema.ts`)
- [x] Tables: organizations, users, sessions, listings, reservations, notifications
- [x] Transaction helper using `BEGIN IMMEDIATE`
- [x] `npm run seed`: 1 admin, 2 approved providers, 1 pending provider, 2 approved
      recipients, 1 pending recipient, 18 listings (12 demo + 6 historical), 10 reservations
- [x] Idempotent seed (drops the DB file, recreates schema, reloads fixtures)
- [x] Demo logins printed on seed

## P2 — Auth, sessions, CSRF, role guards, approval flow

- [x] scrypt password hashing + verification (`lib/crypto.ts`)
- [x] Sessions: random token, SHA-256 stored in `sessions`, httpOnly SameSite=Lax cookie
- [x] CSRF: `X-Requested-With` required on mutating requests (+ optional token match)
- [x] Role guards + capability descriptors returned with auth responses
- [x] Register/login/logout/me/profile/password endpoints
- [x] Admin approve/reject organizations with note + notifications
- [x] Tests: hashing, login, permissions, pending orgs (11 + 10 tests)

## P3 — Listings

- [x] Create/edit/publish/pause/resume/cancel with owner-only access (404 for non-owners)
- [x] Status logic: DRAFT, ACTIVE, PAUSED, RESERVED_OUT, EXPIRED, CANCELLED
- [x] EXPIRED computed on read + persisted by a sweep (per request, throttled to 1/s, and
      a 60-second timer in `index.ts`)
- [x] Public responses expose coordinates rounded to 2 decimals (~1 km)
- [x] Exact address only for the owner and the recipient holding a reservation
- [x] Search: `lat`, `lng`, `radius_km` (default 5, max 50), `storage`, `category`, `q`,
      `sort=nearest|ending_soon`, distance via Haversine + bounding-box prefilter
- [x] `distanceKm`, `secondsLeft`, countdown badges in the client
- [x] Tests: lifecycle, expiry, radius/sorting, privacy, provider approval (7 tests)

## P4 — Reservations

- [x] Reserve with quantity validation (1 ≤ qty ≤ remaining) and pickup slot inside the window
- [x] Stock change inside `BEGIN IMMEDIATE`; RESERVED_OUT ⇄ ACTIVE transitions
- [x] 6-digit code: salted HMAC-SHA256 hash + AES-256-GCM ciphertext for redisplay
- [x] Recipient cancel (restores stock), provider cancel with mandatory reason
- [x] Concurrency test: 20 parallel requests for 5 units → exactly 5 succeed
- [x] Tests: validation, stock, cancel, concurrency (13 tests)

## P5 — Verification + impact

- [x] Provider verification by reservation id or bare code
- [x] Valid only inside `pickup_start … min(pickup_end, window_end)`
- [x] Single use; wrong attempts counted; reservation locked after 5 failures
- [x] On success: status COLLECTED + `collected_at`
- [x] Impact counts only COLLECTED: pickups, quantity, kg, meals estimate (`kg / 0.4`),
      6-month bar chart, storage/category breakdown, recent pickups
- [x] Tests: hash salting, single use, locking, time window, impact scoping (11 tests)

## P6 — Notifications + admin

- [x] `notifications` table + bell data (unread count, mark read, `all` or by id)
- [x] Triggers: reservation created, reservation cancelled, pickup verified, org approved/rejected
- [x] `EmailSender` interface + console implementation (email delivery deferred)
- [x] Admin: pending organizations list, approve/reject with note, platform totals
- [x] Tests: admin review, notification read flow, totals (6 tests)

## P7 — Frontend

- [x] Vite + React 19 + React Router + Tailwind v4 + Leaflet, `/api` proxied to the API
- [x] `/` landing (UNEP 1.05 bn tonnes citation, CTAs, live public stats)
- [x] `/register`, `/login`
- [x] `/browse` list + map, radius/storage filters, sort, countdown badges
- [x] `/listings/:id` detail + reserve form with disabled reasons
- [x] `/provider` my listings, create/edit form, incoming reservations, verify form
- [x] `/recipient` my reservations with codes + cancel
- [x] `/impact` role-specific stats + monthly bar chart
- [x] `/admin` pending organizations + platform totals
- [x] Notification bell with unread count
- [x] Loading / empty / error states everywhere; labelled inputs; visible focus rings
- [~] Manual end-to-end check: register → publish → reserve → verify → impact updates

## P8 — Docs + final verification

- [x] README (what it is, quick start, demo accounts, ASCII architecture, env vars, tests, limits)
- [x] docs/DECISIONS.md (choices, assumptions, deferred features)
- [x] .env.example
- [x] `npm install && npm run seed && npm run dev && npm test && npm run typecheck && npm run build`

## Known follow-ups after v1

- Playwright E2E only if browsers install cleanly (documented as skipped otherwise)
- Deferred features are listed at the bottom of `docs/DECISIONS.md`
