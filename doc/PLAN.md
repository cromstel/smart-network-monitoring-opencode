# Delivery Plan

Seven phases. Each has an entry condition, a definition of done, and a demo — something a person can look at to confirm the phase is real. Do not start a phase until the previous one's DoD is met.

Effort is in ideal engineering days for one developer. Treat them as relative sizes, not commitments.

---

## Phase 0 — Stabilise · ~4d

**Why first:** the tree does not build. Everything downstream is speculative until it does.

**Entry:** none.

Work: `B-01` … `B-08` in `TODO.md`.

1. Resolve the duplicate routes (A-01)
2. Delete `prisma/`; remove Prisma, `pg`, `crypto`, `axios` from dependencies (A-02, A-03, A-06)
3. Stand up `lib/db/` — client, schema types, migrator (A-03)
4. Port `databaseService.ts` to repositories behind the new client (A-03, A-08)
5. Replace Prisma types in `lib/types/` with app-owned domain types; fix the 6 consumers
6. Install the test runner, add the `test` script (A-04)
7. Pin React 19 stable (A-07)
8. Delete build artefacts, status `.txt` files, and the six installers (A-18, A-19, A-20)

**Done when:** `npm run build`, `npm run type-check`, and `npm test` all exit 0. Zero references to `prisma`, `@prisma`, `postgres`, or `pg` anywhere in `app/`, `lib/`, `components/`.

**Demo:** a clean clone builds and boots against SQLite.

---

## Phase 1 — Data foundation · ~5d

**Entry:** Phase 0 done.

1. Migrations `001`–`006` covering every table in `DATABASE.md`
2. Repositories: device, bandwidth, connection log, alert, settings
3. Seed script producing a realistic 12-device network
4. `docker-compose.yml` with MySQL 8 for parity testing
5. Repository test suite, parameterised to run against both dialects
6. Fix BigInt handling end to end (A-05)

**Done when:** the suite passes against SQLite *and* against MySQL in Docker. Seed produces a browsable dataset.

**Demo:** `npm run db:seed && npm run dev` shows 12 devices with history.

---

## Phase 2 — Scanning and bandwidth · ~6d

**Entry:** Phase 1 done.

1. `Scanner` interface and the simulated implementation
2. ARP scanner with a real `isAvailable()` capability probe (A-16)
3. Fallback chain with warning logs (PRD F-07)
4. MAC vendor lookup via `oui-data`, offline
5. `node-cron` scan loop wired through `instrumentation.ts`
6. Connection/disconnection detection writing `connection_logs`
7. Bandwidth sampling and cumulative counters
8. Nightly hourly-aggregate rollup
9. Retention pruning (A-17)

**Done when:** a device joining the network appears within 30s and disappears within 2 missed scans. Pruning is verified to delete rows. Jobs are idempotent.

**Demo:** connect a phone to WiFi; watch it appear unprompted.

---

## Phase 3 — Authentication · ~5d

**Entry:** Phase 2 done. **This gates any non-localhost deployment** (A-10).

1. `users` and `sessions` tables; bcrypt cost 12
2. First-run setup wizard creating the initial ADMIN (PRD F-63)
3. Login, logout, session cookie
4. Real middleware: session check, redirect unauthenticated to `/login`
5. `requireRole()` helper; applied in **every** route handler (PRD F-62)
6. Rate limiting on `/api/auth/*`
7. Route-level authorisation tests, including the negative cases

**Done when:** every route under `/api` except `/api/health` and `/api/auth/*` returns 401 without a session and 403 with an insufficient role. A VIEWER cannot mutate anything.

**Demo:** `curl` an API route without a cookie and get 401.

---

## Phase 4 — Dashboard and real-time · ~7d

**Entry:** Phase 3 done.

1. SSE endpoint and event bus (A-12)
2. `useEventStream` hook invalidating query keys
3. Delete both WebSocket servers
4. Overview: totals, current throughput, peak, top consumers
5. Device table: sort, filter, server-side pagination
6. Device detail: 1h/24h/7d/30d charts, connection timeline
7. Rename and recategorise a device
8. Route every server read through TanStack Query (A-13)
9. Remove all component-level `Math.random()` (A-14)
10. Loading skeletons, empty states, error boundaries
11. Responsive pass at 360 / 768 / 1280 / 2560

**Done when:** no component generates its own data, every server read is a query hook, and the dashboard updates live without a manual refresh.

**Demo:** two browsers side by side; a change in one appears in the other within seconds.

---

## Phase 5 — Alerts, router, settings · ~6d

**Entry:** Phase 4 done.

1. Alert rule engine: unknown device, bandwidth threshold, device offline
2. **Owner-scoped** alert queries with an explicit cross-user leak test (PRD F-34)
3. Activity log with acknowledgement
4. AES-256-GCM credential storage (A-09)
5. ASUS router client behind the `Scanner` interface
6. Settings UI: subnet, interval, retention, notification preferences, theme
7. Router connection test that never echoes the password back

**Done when:** an unknown device raises exactly one alert, to exactly the right user. No plaintext credential exists in the database. A test asserts that user A never receives user B's alert.

**Demo:** a device the system has never seen connects; the correct user is notified.

---

## Phase 6 — Hardening and release · ~5d

**Entry:** Phase 5 done.

1. Playwright E2E: login, list, rename, history, alert configuration
2. Coverage to ≥ 70% on `lib/services/` and `lib/utils/`
3. CI: build, type-check, unit, MySQL integration, E2E
4. Performance pass against the PRD §5 targets
5. 24-hour soak — watch for memory growth and unhandled rejections
6. `scripts/setup.ts` replacing the deleted installers (A-20)
7. `DEPLOYMENT.md`, `TROUBLESHOOTING.md`
8. Walk `PRD.md` §7 line by line

**Done when:** every box in PRD §7 is ticked.

**Demo:** a stranger follows `DEPLOYMENT.md` on a clean machine and reaches a working dashboard.

---

## Phase 7 — Post-1.0 (not scheduled)

Multi-tenancy: `Organization` as tenant root, every query and notification scoped by `organizationId`, plan tiers with enforced limits, Stripe billing and webhooks. This is a substantial refactor of every repository and route handler — it is a v2.0 project, not a v1.0 stretch goal.

Then: anomaly detection · TP-Link and Netgear clients · guest network management · speed-test integration · mobile apps.

---

## Sequencing notes

- Phases 0–2 are strictly serial; each builds the floor the next stands on.
- Phase 3 can start once Phase 1 lands if a second developer is available — it touches different files. Phase 4 needs both.
- Phase 5's alert scoping is the highest-risk item in the plan. A cross-user notification leak has happened before on a related project. Write the negative test before the feature.
- Cumulative: ~38 ideal days to v1.0.
