# Backlog

Ordered. Work top to bottom. `A-nn` refers to `AUDIT.md`; phases to `PLAN.md`.

Task format: `[ ] B-nn — title (size) [audit ref]` followed by acceptance criteria.
Sizes: **S** ≤2h · **M** half a day · **L** 1–2 days.

When you finish a task: tick it, and if it changed a decision, add a line to `MEMORY.md` §5.

---

## Phase 0 — Stabilise

- [ ] **B-01 — Resolve duplicate routes** (M) `A-01`
  - Delete `app/settings/page.tsx`; `app/(dashboard)/settings/page.tsx` owns `/settings`
  - Move the dashboard body into `app/(dashboard)/page.tsx`; `app/page.tsx` becomes the landing page or a redirect
  - Reconcile `app/router/page.tsx` with `app/(dashboard)/integrations/page.tsx` — one owner
  - AC: `next build` reports no route conflict

- [ ] **B-02 — Delete Prisma** (S) `A-02` `A-03`
  - `rm -rf prisma/ lib/db.ts`
  - Remove `@prisma/client`, `@prisma/extension-accelerate`, `prisma`, `pg`, `crypto`, `axios` from `package.json`
  - Remove the `db:push`/`db:studio`/`db:migrate`/`db:generate` scripts
  - AC: `grep -ri "prisma\|@prisma" app lib components package.json` returns nothing

- [ ] **B-03 — Build the data layer** (L) `A-03` `A-08`
  - Add `kysely`, `mysql2`, `better-sqlite3`
  - `lib/db/client.ts` per `ARCHITECTURE.md` §4 — single pool, `globalThis` cached
  - `lib/db/schema.ts` — Kysely table interfaces
  - `lib/db/migrator.ts` + `lib/db/migrations/`
  - `lib/config.ts` — Zod-validated env, fails fast
  - AC: the app connects to SQLite and to MySQL by flipping `DB_CLIENT`; exactly one pool per process

- [ ] **B-04 — App-owned domain types** (M) `A-03`
  - Define `Device`, `BandwidthMetric`, `ConnectionLog`, `DeviceAlert`, `UserSettings` in `lib/types/`
  - Fix the six consumers: `lib/services/deviceFiltering.ts`, `lib/hooks/useDevices.ts`, `lib/context/AppContext.tsx`, `components/DeviceCard.tsx`, `app/api/devices/scan/route.ts`, `app/api/router/config/route.ts`
  - AC: no generated type is imported anywhere; `npm run type-check` passes

- [ ] **B-05 — Port `databaseService.ts` to repositories** (L) `A-03` `A-08`
  - Split into `deviceRepository.ts`, `bandwidthRepository.ts`, `connectionLogRepository.ts`
  - Each imports `db` — none constructs a connection
  - AC: the existing API routes work unchanged against the new repositories

- [ ] **B-06 — Install the test runner** (M) `A-04`
  - Add `jest`, `jest-environment-jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@types/jest`, `ts-node`
  - Add `"test": "jest"`, `"test:watch": "jest --watch"`, `"test:coverage": "jest --coverage"`
  - Verify `jest.config.js` `moduleNameMapper` resolves the `@/` alias
  - AC: `npm test` runs the 6 existing test files

- [ ] **B-07 — Pin React 19 stable** (S) `A-07`
  - `react`, `react-dom`, `@types/react`, `@types/react-dom` → stable `^19`
  - AC: build and tests pass

- [ ] **B-08 — Clean the repo root** (S) `A-18` `A-19` `A-20`
  - Delete `tsconfig.tsbuildinfo`, the 22 status `.txt` files, `installer*.sh`, `install-web*.html`, `home-network-monitor-project.zip`
  - `.gitignore`: `node_modules/`, `.next/`, `*.tsbuildinfo`, `.env*` (not `.env.example`), `data/`, `coverage/`
  - Add root `.env.example` per `ARCHITECTURE.md` §7
  - AC: root holds only source, config, and `docs/`

---

## Phase 1 — Data foundation

- [x] **B-10 — Migrations 001–006** (L)
  - `001_devices`, `002_bandwidth_metrics`, `003_connection_logs`, `004_alerts_notifications`, `005_settings_router`, `006_network_metrics` per `DATABASE.md`
  - Every migration has a working `down`
  - AC: migrate up then down then up, clean, on both dialects — up/down round-trip verified on SQLite;
    the MySQL leg runs through B-13/B-14 in CI

- [x] **B-11 — Fix BigInt end to end** (M) `A-05`
  - `bigNumberStrings: true` on the MySQL pool
  - Repositories return byte counters as `string`
  - API exposes `{ bytes: string, megabytes: number }` — serialiser emits `totalTransferred.uploadBytes/downloadBytes` as `string`
  - AC: `GET /api/devices` integration test asserts a counter above `Number.MAX_SAFE_INTEGER` serialises exactly
    (`lib/__tests__/api.devices.integration.test.ts`)

- [x] **B-12 — Seed script** (M)
  - 12 devices across types, 7 days of bandwidth, connection events, 3 alerts
  - AC: `npm run db:seed` on an empty DB yields a browsable dashboard — verified; refuses to double-seed

- [x] **B-13 — MySQL in Docker** (S)
  - `docker-compose.yml` with MySQL 8, healthcheck, named volume
  - AC: `docker compose up -d && DB_CLIENT=mysql npm test` passes — file written; not run locally
    (no Docker in this environment) — will run in CI

- [x] **B-14 — Dual-dialect repository tests** (L)
  - Parameterise the suite over both dialects
  - `lib/db/__tests__/harness.ts` drives the shared client; `jest.setup.js` pins `DB_FILE=:memory:`
    and routes `RUN_MYSQL_TESTS=1` to MySQL
  - AC: every repository test runs twice; both green — SQLite leg green locally, MySQL leg in CI

---

## Phase 2 — Scanning and bandwidth

- [x] **B-20 — Scanner interface + simulated** (M)
  - `lib/services/scanners/{types,simulatedScanner}.ts`
  - AC: simulated scanner is the only source of fake data in the codebase

- [x] **B-21 — ARP scanner with capability probe** (L) `A-16`
  - `isAvailable()` checks for the binary and `CAP_NET_RAW` before first use
  - AC: on a machine without privileges, it reports unavailable and does not throw

- [x] **B-22 — Fallback chain** (M)
  - Order per `ARCHITECTURE.md` §5; each fallback logs what failed and what it chose
  - AC: forcing `SCANNER_MODE=arp` without privileges falls back to simulated with one clear warning

- [x] **B-23 — Offline MAC vendor lookup** (S)
  - `oui-data`, normalised uppercase MAC
  - AC: a known OUI resolves with no network access

- [x] **B-24 — Cron jobs** (L) `A-17`
  - Scan loop, hourly rollup, nightly retention prune, all via `instrumentation.ts`
  - AC: pruning deletes rows past `dataRetentionDays`; running a job twice does not double-count

- [x] **B-25 — Connection event detection** (M)
  - Diff each scan against known state; write `connection_logs`; set duration on disconnect
  - AC: 2 missed scans marks offline (PRD F-06)

---

## Phase 3 — Authentication

- [x] **B-30 — Users and sessions** (L)
  - `users`, `sessions` tables; bcrypt cost 12; `userRepository`
  - AC: passwords verify; no hash is ever returned by an API route

- [x] **B-31 — First-run setup** (M) `A-20`
  - `scripts/setup.ts` + a `/setup` wizard creating the first ADMIN; unreachable once a user exists
  - AC: a fresh install reaches a usable login without editing files by hand

- [x] **B-32 — Login, logout, session cookie** (M)
  - httpOnly, sameSite=lax, secure in production, sliding 7-day expiry
  - AC: expired sessions are rejected and cleaned up

- [x] **B-33 — Real middleware** (M) `A-10`
  - Session check; unauthenticated → `/login`; allowlist `/login`, `/setup`, `/api/health`, `/api/auth/*`
  - AC: no page or API route is reachable without a session outside the allowlist

- [x] **B-34 — Per-route authorisation** (L) `A-10`
  - `requireRole()` applied in **every** route handler (PRD F-62)
  - AC: a VIEWER session gets 403 on every mutating route — one test per route

- [x] **B-35 — Auth rate limiting** (S)
  - AC: repeated failed logins are throttled; the limit is covered by a test

---

## Phase 4 — Dashboard and real-time

- [ ] **B-40 — SSE endpoint and event bus** (L) `A-12`
  - `app/api/events/route.ts`, `lib/services/eventBus.ts`, 30s keep-alive
  - AC: two clients both receive an event; disconnect is clean, no leaked listener

- [ ] **B-41 — Delete the WebSocket servers** (S) `A-12`
  - Remove `lib/websocket/server.ts`, `lib/services/websocketServer.ts`, `lib/hooks/useWebSocket.ts`
  - AC: no `ws` reference remains

- [ ] **B-42 — `useEventStream` hook** (M)
  - Subscribes, invalidates query keys, reconnects with backoff
  - AC: killing the server and restarting it resumes updates without a page reload

- [ ] **B-43 — Overview page** (L)
  - Totals, current throughput, today's peak, top consumers
  - AC: every figure traces to a repository query; none is computed in the component

- [ ] **B-44 — Device table** (L)
  - Sort, filter, server-side pagination past 50 rows
  - AC: 100 devices render without visible lag (PRD §5)

- [ ] **B-45 — Device detail** (L)
  - 1h/24h/7d/30d charts, connection timeline, rename, recategorise
  - AC: 30-day history returns in under 1s against seeded MySQL

- [ ] **B-46 — All server state through TanStack Query** (L) `A-13`
  - AC: no component holds server data in `useState`

- [ ] **B-47 — Remove component-level randomness** (M) `A-14`
  - AC: `grep -rn "Math.random()" app components` returns nothing

- [ ] **B-48 — Loading, empty, error states** (M)
  - Skeletons, empty states, error boundaries on every async surface
  - AC: no surface can show a blank panel with no explanation

- [ ] **B-49 — Responsive pass** (M)
  - 360 / 768 / 1280 / 2560
  - AC: no horizontal scroll, no clipped control at any breakpoint

---

## Phase 5 — Alerts, router, settings

- [ ] **B-50 — Alert rule engine** (L)
  - Unknown device, bandwidth threshold, device offline
  - AC: one connection raises exactly one alert — no duplicates across scan cycles

- [ ] **B-51 — Owner-scoped alerts** (M) `PRD F-34`
  - Every alert query filtered by owner
  - **Write the negative test first:** user A must never receive user B's alert
  - AC: the cross-user leak test exists and passes

- [ ] **B-52 — Activity log** (M)
  - Persisted, acknowledgeable, filterable by type and date
  - AC: acknowledgement survives a restart

- [ ] **B-53 — Encrypt router credentials** (M) `A-09`
  - AES-256-GCM, `iv:authTag:ciphertext`, key from `ENCRYPTION_KEY`
  - AC: no plaintext password in the DB; no API shape includes the field

- [ ] **B-54 — ASUS router client** (L)
  - Behind the `Scanner` interface; timeouts and retries
  - AC: an unreachable router degrades to ARP, logs once, does not crash

- [ ] **B-55 — Settings UI** (L)
  - Subnet, interval, retention, notifications, theme — Zod-validated, persisted
  - AC: changing the interval takes effect without a restart

---

## Phase 6 — Hardening and release

- [ ] **B-60 — Playwright E2E** (L)
  - login · device list · rename · history · configure alert
  - AC: the five specs pass in CI (browser CDN is unreachable locally — `MEMORY.md` §6)

- [ ] **B-61 — Coverage to 70%** (L)
  - `lib/services/` and `lib/utils/`
  - AC: `npm run test:coverage` meets the threshold; the threshold is enforced in config

- [ ] **B-62 — CI pipeline** (M)
  - build · type-check · unit · MySQL integration · E2E
  - AC: a PR that breaks any stage is blocked

- [ ] **B-63 — Performance pass** (M)
  - Against PRD §5 targets; record the numbers in `docs/PERFORMANCE.md`
  - AC: every target met or the gap documented with a reason

- [ ] **B-64 — 24-hour soak** (M)
  - AC: no memory growth trend, no unhandled rejection, no connection-pool exhaustion

- [ ] **B-65 — Deployment docs** (M)
  - `DEPLOYMENT.md`, `TROUBLESHOOTING.md`, Dockerfile reviewed for `NET_RAW`
  - AC: someone else follows it on a clean machine and succeeds

- [ ] **B-66 — Release checklist** (S)
  - Walk `PRD.md` §7 line by line
  - AC: every box ticked, or the gap is recorded as a known limitation
