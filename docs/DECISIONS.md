# FreshRelay — decisions log

Every non-obvious choice made while building the MVP, plus the assumptions behind them and
everything deliberately deferred. Written so a future maintainer can see *why*, not just *what*.

---

## 1. Runtime, storage and tooling

| Decision | Why |
| --- | --- |
| **Node 22 + TypeScript everywhere** | Required by the brief; Node 22 also ships `node:sqlite`, which removes the need for a native build step. |
| **`node:sqlite` (`DatabaseSync`) instead of `better-sqlite3`** | Verified working on Node v22.22.3 before committing to it. It needs no compile toolchain and no download, so `npm install` stays fast and portable. It emits an `ExperimentalWarning`; the `npm start` script silences that one warning with `--disable-warning=ExperimentalWarning`. The `Db` wrapper in `server/src/db/index.ts` is the single place that touches the driver, so a swap to `better-sqlite3` (the documented fallback) is a ~40-line change. |
| **Synchronous SQLite + `BEGIN IMMEDIATE`** | The driver is synchronous, so a transaction body cannot be interleaved by another request in the same process. That is what makes "20 parallel reservations for 5 units → exactly 5 succeed" hold without a connection pool, row locks or an external queue. |
| **No Docker / Postgres / Redis** | Not available in the target environment, and not needed for an MVP. Sessions live in a `sessions` table, not Redis. |
| **esbuild for the server build (not `tsc --emit`)** | Node ESM requires explicit file extensions in relative imports, which fights the shared-schema alias and forces `.js` specifiers that Vite then has to map back to `.ts`. Bundling sidesteps it: relative imports are inlined, dependencies stay external. `npm run typecheck` still runs the full TypeScript compiler over the sources, so no type safety is lost. |
| **Zod 4 schemas live in `server/src/schemas` and are imported by the client** | One source of truth for enums, request validation and response types. The client imports them through the `@shared` alias (Vite alias + tsconfig path) and only ever pulls *types and constants* — never server runtime code. |
| **Tailwind CSS v4 (`@tailwindcss/vite`)** | Zero-config content detection, no `tailwind.config.js` to maintain. Note: v4 cannot `@apply` a custom class from inside another custom class, so the shared button shell is declared once for all three variants in `index.css`. |
| **`.md` files are excluded from Prettier** | Keeps hand-written prose and tables untouched by the formatter. |

## 2. Authentication and sessions

- **scrypt from `node:crypto`** with `N=16384, r=8, p=1`, a 16-byte random salt per password, stored as
  `scrypt$N$r$p$salt$hash`. No native dependency, ~60 ms per hash locally.
- **Sessions are random 256-bit tokens**; only `sha256(token)` is stored in `sessions`, along with a
  separate 192-bit `csrf_token`. The cookie is `httpOnly`, `SameSite=Lax`, `Path=/`, with a 30-day TTL,
  and `Secure` when `COOKIE_SECURE=true` (forced on in production).
- **Login always runs a scrypt verification**, even for unknown emails, so timing does not reveal whether
  an account exists.
- **CSRF**: every mutating `/api` request must carry `X-Requested-With` (the brief's rule). Additionally,
  if the client supplies `X-CSRF-Token` and a session exists, it must match the session's token — a
  double-submit check that costs nothing because the client always sends both.
- **Role guards return 404, not 403, for other people's resources.** "Recipient cannot create a listing"
  and "provider cannot reserve" are 403 (`WRONG_ROLE`) because the *action* is wrong, but touching a
  listing or reservation owned by another organization is a 404 so the API never confirms that the
  resource exists. Both behaviours are covered by tests.
- **Capabilities are computed server-side and shipped with every auth response**
  (`canPublishListing`, `canReserve`, `canVerifyPickup`, `canModerateOrganizations`, `blockedReason`).
  The UI renders reasons from the server rather than duplicating business rules in React.

## 3. Organization approval

- New provider/recipient organizations are created as `PENDING`, and the user's role is `PROVIDER` or
  `RECIPIENT` (never `ADMIN` — admins are seeded/created out of band, which also means the public
  register endpoint cannot mint admins).
- **Pending providers can save drafts** but `PUBLISH` returns `409 ORG_NOT_APPROVED`. Pending recipients
  can browse and log in but reserving returns `403 ORG_PENDING`.
- Approval/rejection records `review_note`, `reviewed_at`, `reviewed_by`, notifies every user in the
  organization in-app and calls the email sender (console implementation).

## 4. Listings

- **Status is computed on read** (`computeListingStatus`) and persisted by a sweep, so a stale row can
  never be served as `ACTIVE`. The sweep runs at most once per second on API requests *and* on a
  60-second timer (the timer keeps statuses correct while the app is idle). A single `UPDATE` handles
  it: `ACTIVE|PAUSED|RESERVED_OUT` → `EXPIRED` once `now > expires_at`.
- **`DRAFT` is exempt from expiry** and stays a draft even if its window passes; the provider sees the
  countdown, and publishing an out-of-window listing is refused with `409 WINDOW_CLOSED`.
- **`expires_at` may be earlier than `window_end` but never later.** Food must not stay listed after the
  pickup window closes, so the API rejects `expires_at > window_end` with a message that explains why.
  Default is `window_end`.
- **Privacy model**: public responses expose coordinates rounded to 2 decimals (~1.1 km) and a
  provider name/type. The exact `pickupAddress` and `pickupInstructions` are only included for the
  owning provider, an admin, or a recipient who currently holds a `RESERVED` reservation.
- **Draft / paused / cancelled / expired listings are hidden behind a 404** for everyone except the
  owner and admins.
- **Search** does a bounding-box prefilter in SQL (index-friendly) and then Haversine in JS, filtering to
  the exact radius. Only `ACTIVE`, non-expired listings from `APPROVED` provider organizations are
  returned, capped at 500 candidates. `radius_km` defaults to 5 and is capped at 50 (a larger value is a
  400, not a silent clamp).
- **Facets** (`availableStorage`, `availableCategories`) are computed from the radius-filtered candidate
  set *before* the storage/category filters, so the filter dropdowns do not empty themselves.
- **Editing** a listing with live reservations is constrained: quantity cannot drop below the reserved
  amount (`409 QUANTITY_BELOW_RESERVED`) and a narrowed pickup window must still cover existing
  reservations (`409 WINDOW_EXCLUDES_RESERVATIONS`).
- **Cancelling a listing cancels its live reservations** with a reason and releases the stock.

## 5. Reservations and stock control

- Quantity must satisfy `1 ≤ qty ≤ remaining`. The authoritative check happens **inside**
  `BEGIN IMMEDIATE`: re-read the listing, re-derive its status, re-check stock, decrement, insert the
  reservation, then set the listing to `RESERVED_OUT` when remaining hits 0.
- **Pickup slot rules**: defaults to `max(now, window_start) … window_end`. A supplied slot must sit
  inside `[window_start, window_end]`, must have `end > start`, and must end in the future. A slot that
  starts in the past is clamped to now.
- **Restoring stock** happens on cancellation only. A `RESERVED_OUT` listing flips back to `ACTIVE` as
  soon as `quantity_remaining > 0`, provided the listing has not expired or been cancelled.
- Reservations past `pickup_end` are marked `EXPIRED` by the same sweep. Because a reservation's pickup
  slot always lies inside the listing window, this can only happen for listings that are themselves
  expired, so no stock is orphaned.
- **Cancellation rules**: the recipient can cancel (reason optional). A provider cancelling *someone
  else's* reservation must supply a reason (400 otherwise). Cancelling a `COLLECTED` or already
  cancelled reservation is a 409.

### Pickup-code storage (chosen approach)

Each reservation gets a uniformly random 6-digit code. Two representations are stored, never the plaintext:

```
code_hash      = HMAC-SHA256(APP_SECRET, reservation_id || ":" || code)   -> 64 hex chars, single-use check
code_encrypted = AES-256-GCM(code, key = HKDF-style HMAC(APP_SECRET, "pickup-code-encryption"))
                 formatted as "v1:<iv>:<tag>:<ciphertext>" (base64url)
```

*Why both?* The brief asks to "store only a hash" **and** to show the code again on the recipient's
reservations page. Those are in tension, so: the **hash is the verification path** (constant-time
compare, salted with the reservation id so a DB dump cannot be used as a lookup table for all
reservations at once), and the **AES-GCM ciphertext exists only so the legitimate recipient can re-read
their own code**. Rotating `APP_SECRET` invalidates stored codes by design. A 10^6 code space is only
safe because it is peppered with the server secret, salted per reservation, unguessable by brute force
online, and hard-locked after 5 failures.

- **Providers never receive pickup codes** through the API — not in the reservations list, not in the
  detail view. Verification is the proof of handover; if the provider could read the code, the check
  would be theatre. The recipient reveals it on `/recipient` when handing over.
- **Verification order** (matters for both UX and security): ownership → state (`COLLECTED` → `409
  CODE_ALREADY_USED`, cancelled → `409`) → lock (`423`) → time window (`409 PICKUP_NOT_STARTED` /
  `PICKUP_WINDOW_CLOSED`) → code. A wrong-time attempt **never** consumes an attempt or locks the
  reservation.
- **Window used for verification** is `pickup_start … min(pickup_end, listing.window_end)`, which is
  exactly `pickup_start … window_end` for the default slot the UI creates.
- **5 wrong attempts lock the reservation** (`423`, `locked_at` set). Locked reservations can only be
  released by an admin out of band (no v1 UI).
- **Two verification flows**: with `reservationId` (the dashboard's "verify this pickup" action, which is
  what counts attempts) or by code alone. The code-only flow searches the provider's reservations —
  pending ones first, then finished ones — so reusing a code reports `CODE_ALREADY_USED` instead of a
  vague "unknown code". Because a failed lookup has no reservation to attach attempts to, the code-only
  flow does not consume attempts (documented, and the reason the UI defaults to the targeted flow).

## 6. Impact reporting

- **Only `COLLECTED` reservations count.** Nothing is reported on reservation or delivery promises.
- **`kg` is exact, other units are not mixed into it.** `totals.kg` sums only rows whose unit is a kg
  variant (`kg`, `kgs`, `kilogram(s)`, `kilo(s)`); everything else is summed separately into
  `unitFreeQuantity` and surfaced as "plus N in non-kg units". Adding `40 loaves` to `12 kg` would be a
  fabricated statistic, and the MVP would rather show less than lie.
- **Meals estimate**: `meals = rescued kg / MEALS_KG_PER_MEAL` with `MEALS_KG_PER_MEAL = 0.4` as a
  config constant. The formula and the word *estimate* are displayed next to every number in the UI,
  and the API returns both the formula string and a plain-language note so any client shows them too.
  0.4 kg/meal is the common food-bank planning figure; it is an assumption, not a measurement.
- The monthly chart covers the **last 6 calendar months**, oldest first, and always returns all six
  buckets (zeros included) so the chart does not silently change width month to month.
- Impact is scope-aware: providers see only their own listings, recipients only their own collections,
  admins see the platform. A provider with no collected pickups gets zeros, not someone else's numbers.

## 7. Notifications and email

- `notifications` is a per-user table with `type`, `title`, `body`, `link`, `entity_id`, `read_at`.
  Triggers: reservation created, reservation cancelled (either side), pickup verified (both sides), and
  organization approved/rejected.
- The bell polls every 60 seconds and after any action that could change it; unread count comes from the
  server, and "mark all read" is the default read action (`POST /api/notifications/read`).
- **Email is deferred.** `EmailSender` (`server/src/emails/sender.ts`) defines
  `send({to, subject, body, template})`; `ConsoleEmailSender` logs and `MemoryEmailSender` records for
  tests. Every call site already exists (reservation created/cancelled, pickup verified, org
  approved/rejected) and is fire-and-forget, so swapping in SMTP/Resend/Postmark is a one-file change
  that cannot break a request path.

## 8. Testing strategy

- **Server**: Vitest against a Fastify instance built on an in-memory SQLite database, driven entirely
  through `app.inject` — no ports, no external services, no browser. Each test file gets a fresh
  database through `createTestHarness()`.
- **Client**: Vitest + jsdom + Testing Library. Components are tested directly (countdown, listing card,
  chart, badges) and a route-level smoke test mounts the whole app per route with a stubbed API, which
  stands in for manual clicking.
- **Playwright E2E is skipped, with evidence.** Chromium cannot be downloaded in this environment:
  `npx playwright@1.55.0 install chromium` fails with `Failed to download Chromium … Download failure`
  because only the npm/PyPI/GitHub hosts are reachable. The client-side smoke test plus the scripted
  end-to-end API walkthrough (register → publish → reserve → verify → impact) cover the same flow
  without a browser.
- Deliberately **not** mocked anywhere: password hashing, SQLite transactions, session/cookie handling,
  stock arithmetic and code hashing all run for real in tests.

## 9. Assumptions worth flagging

1. **Meals factor 0.4 kg/meal**, configurable via `MEALS_KG_PER_MEAL`; always labelled an estimate.
2. **Timezone**: everything is stored and returned as ISO-8601 UTC; the browser renders local time.
3. **Geo**: Haversine on a sphere (mean radius 6371.0088 km), 2-decimal rounding for public
   coordinates. Good to a few metres, far beyond what food pickup routing needs.
4. **Admin accounts** are not self-service: `POST /api/auth/register` cannot create one.
5. **One organization per user** in v1; there is no multi-org membership or role switching.
6. **Quantity units are free text** (`kg`, `loaves`, `boxes`, `meals`, …); only kg variants feed the kg
   totals and the meals estimate.
7. **No hard delete** of listings, reservations or organizations — cancellation and status changes only,
   so the audit trail (and the impact numbers) stay honest.
8. **`APP_SECRET` defaults to a development value.** The server logs a warning at boot and refuses to
   start in production without an explicit secret, because the secret protects stored pickup codes.
9. **Single-process deployment.** In-process state is limited to the sweep throttle, so a second
   instance would be safe for reads but should get a real job runner before it is scaled out.

## 10. Deferred (explicitly out of scope for v1)

- Email delivery (interface + console implementation only)
- Password reset / email verification / 2FA
- Background job queue and scheduled reminders ("your pickup is in 30 minutes")
- QR code scanning of pickup codes (typed 6 digits only)
- Photo upload for listings and proof-of-pickup
- PostGIS / real routing / drive-time isochrones (Haversine + bounding box only)
- Payments, donations and financial reporting
- Native mobile app and push notifications
- Account/organization deletion UI (and GDPR-style data export)
- OpenAPI/Swagger generation (the API index lives at `GET /api`)
- Playwright E2E (blocked by the sandbox download restriction, see §8)
- Multi-org users, per-user invitation flows, and admin unlocking of locked reservations
- Pagination/infinite scroll on search (hard 500-candidate cap instead)
- Real-time updates (polling only)
