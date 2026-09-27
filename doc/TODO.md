# Backlog

Ordered. Work top to bottom. `A-nn` refers to `AUDIT.md`; phases to `PLAN.md`.

Task format: `[ ] B-nn — title (size) [audit ref]` followed by acceptance criteria.
Sizes: **S** ≤2h · **M** half a day · **L** 1–2 days.

When you finish a task: tick it, and if it changed a decision, add a line to `MEMORY.md` §5.

---

## Phase 0 — Stabilise

- [x] **B-01 — Resolve duplicate routes** (M) `A-01`
  - Deleted `app/page.tsx`; it and `app/(dashboard)/page.tsx` both resolved to `/`
  - The dashboard owns `/`; `/login` and `/setup` are the only other pages
  - AC: `next build` reports no route conflict — passes

- [x] **B-02 — Delete Prisma** (S) `A-02` `A-03`
  - AC: `grep -ri "prisma" app lib package.json` returns nothing

- [x] **B-03 — Build the data layer** (L) `A-03` `A-08`
  - `lib/db/client.ts` — single pool, `globalThis` cached
  - AC: the app connects to SQLite and to MySQL by flipping `DB_CLIENT`

- [x] **B-04 — App-owned domain types** (M) `A-03`
  - AC: `npm run type-check` passes; no generated type is imported

- [x] **B-05 — Port `databaseService.ts` to repositories** (L) `A-03` `A-08`
  - `deviceRepository`, `bandwidthRepository`, `connectionLogRepository`,
    `userRepository`, `alertRepository`, `settingsRepository`

- [x] **B-06 — Install the test runner** (M) `A-04`
  - AC: `npm test` runs the suite; 155 tests green

- [x] **B-07 — Pin React 19 stable** (S) `A-07`

- [x] **B-08 — Clean the repo root** (S) `A-18` `A-19` `A-20`
  - Fixed `.gitignore`: `.env*` (glob), not `.env.*`. A file named
    `.env local` with a space had been committed under the old rule, along
    with a live MySQL password. That credential should be rotated.

---

## Phase 1 — Data foundation

- [x] **B-10 — Migrations 001–006** (L)
  - Every migration has a working `down`; round-trip verified on SQLite

- [x] **B-11 — Fix BigInt end to end** (M) `A-05`
  - AC: `GET /api/devices` asserts a counter above `Number.MAX_SAFE_INTEGER`
    serialises exactly — `lib/__tests__/api.devices.integration.test.ts`
  - Note: `defaultSafeIntegers` also makes every INTEGER column a `bigint`.
    Repositories must normalise with `Number(...)` or booleans silently read
    as `false`. See `mappers.ts`.

- [x] **B-12 — Seed script** (M)
  - AC: refuses to double-seed; the seeded admin deliberately has no usable
    password. `scripts/e2e-seed.ts` is the separate, known-password variant.

- [x] **B-13 — MySQL in Docker** (S)
  - AC: runs in CI on the MySQL leg

- [x] **B-14 — Dual-dialect repository tests** (L)
  - AC: every repository test runs twice; both green in CI

---

## Phase 2 — Scanning and bandwidth

- [x] **B-20 — Scanner interface + simulated** (M)
- [x] **B-21 — ARP scanner with capability probe** (L) `A-16`
- [x] **B-22 — Fallback chain** (M)
  - Each fallback logs what failed and what it chose
- [x] **B-23 — Offline MAC vendor lookup** (S)
  - `normalizeMac` now throws on anything that is not 48 bits. It used to
    strip non-hex characters, turning `"not-a-mac"` into `"A:C"` and writing
    a phantom device to the database.
- [x] **B-24 — Cron jobs** (L) `A-17`
  - `instrumentation.ts` sits in the **repository root** with a `register()`
    export. In `lib/` Next.js never loaded it and no job ever ran.
  - Scanning uses a self-rescheduling timer, not cron: `SCAN_INTERVAL_SECONDS`
    is configurable over 30–3600 and cron cannot express an interval that
    does not divide 60.
- [x] **B-25 — Connection event detection** (M)
  - AC: 2 missed scans marks offline (PRD F-06)

---

## Phase 3 — Authentication

- [x] **B-30 — Users and sessions** (L)
- [x] **B-31 — First-run setup** (M) `A-20`
  - `/setup` creates the first ADMIN and 409s once any user exists. It is
    reachable without a session by necessity — the first account is the one
    that grants ADMIN — so it is rate limited to 5/hour and enforces a
    12-character password policy.
- [x] **B-32 — Login, logout, session cookie** (M)
  - `/login` and `/setup` pages exist; `useSearchParams` is behind Suspense
- [x] **B-33 — Real middleware** (M) `A-10`
- [x] **B-34 — Per-route authorisation** (L) `A-10`
  - `lib/api/auth.ts` re-validates the session cookie in every handler rather
    than trusting middleware headers (PRD F-62)
- [x] **B-35 — Auth rate limiting** (S)
  - Applied to `/api/auth/login` and `/api/setup`

---

## Phase 4 — Dashboard and real-time

- [x] **B-40 — SSE endpoint and event bus** (L) `A-12`
  - `scanJob` is the producer; before this it emitted nothing and the stream
    carried only keep-alives
- [x] **B-41 — Delete the WebSocket servers** (S) `A-12`
- [x] **B-42 — `useEventStream` hook** (M)
  - One connection per tab, opened in the dashboard layout
  - AC: backoff reconnect after a server restart
- [ ] **B-43 — Overview page** (L)
  - Totals, current throughput, today's peak, top consumers
  - AC: every figure traces to a repository query
- [x] **B-44 — Device table** (L)
  - Sort, filter, pagination; 14 component tests
- [x] **B-45 — Device detail** (L)
  - Range selector, Recharts, rename dialog
  - AC: 30-day history under 1s against seeded MySQL — **not yet measured**,
    see B-63
- [x] **B-46 — All server state through TanStack Query** (L) `A-13`
- [x] **B-47 — Remove component-level randomness** (M) `A-14`
- [x] **B-48 — Loading, empty, error states** (M)
- [x] **B-49 — Responsive pass** (M)
  - Sidebar collapses to a horizontal bar below `md`

---

## Phase 5 — Alerts, router, settings

- [x] **B-50 — Alert rule engine** (L)
  - AC: one connection raises exactly one alert — `scanJob.test.ts` scans the
    same device four times and asserts a single notification
- [x] **B-51 — Owner-scoped alerts** (M) `PRD F-34`
  - The negative test is written first: `alertEngine.leak.test.ts` plus
    `settingsAndAlerts.test.ts`
- [x] **B-52 — Activity log** (M)
  - Persisted, acknowledgeable, filterable by type
- [x] **B-53 — Encrypt router credentials** (M) `A-09`
  - `lib/utils/encryption.ts` — AES-256-GCM, `iv:authTag:ciphertext`
  - AC: 11 tests cover round-trip, tampering, wrong key, malformed input
  - Note: this module was previously unusable — it demanded a 64-hex key
    while the dev fallback is a 32-character word, so every call threw.
- [x] **B-54 — ASUS router client** (L)
  - Behind the `Scanner` interface, with timeouts
  - Gap: no test drives the HTTP client. `isAvailable` and `scan` need a
    mocked `fetch` — worth doing before relying on it
- [x] **B-55 — Settings UI** (L)
  - AC: Zod-validated at the route boundary, persisted per user

---

## Phase 6 — Hardening and release

- [x] **B-60 — Playwright E2E** (L)
  - login · device list · rename · history · configure alert
  - Specs in `e2e/`; runs in CI. Not yet executed locally — the browser CDN
    is unreachable from this environment (see `MEMORY.md` §6)
- [x] **B-61 — Coverage to 70%** (L)
  - 85% statements and lines on `lib/services` and `lib/utils`; the threshold
    is enforced and verified to fail the build
- [x] **B-62 — CI pipeline** (M)
  - type-check · build · SQLite suite · MySQL suite · E2E
- [ ] **B-63 — Performance pass** (M)
  - Every PRD §5 target is unmeasured. Nothing in the suite asserts the
    30-day query budget or the /24 scan time. `doc/PERFORMANCE.md` does not
    exist yet
- [ ] **B-64 — 24-hour soak** (M)
  - No memory-growth or unhandled-rejection evidence
- [x] **B-65 — Deployment docs** (M)
  - `doc/DEPLOYMENT.md`, `doc/TROUBLESHOOTING.md`, `Dockerfile`, Compose
- [ ] **B-66 — Release checklist** (S)
  - Remaining PRD §7 gaps: B-63, B-64, and the ASUS client test

---

## Known follow-ups

- **Rotate the leaked MySQL credential.** A `.env local` file containing a live
  password was committed in `9706a83` and removed in `94e4918`. Git history
  still contains it; only rotation actually closes the exposure.
- **ASUS scanner HTTP client is untested.** Logic is sound but unexercised.
- **`scanWith` in `scanJob.ts` is unused** outside tests — either adopt it or
  remove it.
- **Multi-instance deployments need a shared rate-limit store.** The current
  store is in-process, so limits are per container.
- **CSRF** is mitigated by `sameSite=lax` rather than by a token. Adequate for
  a single-origin dashboard; revisit if the API is ever called cross-site.
