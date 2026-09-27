# MEMORY — Persistent Agent Context

Read this file **first**, at the start of every session, before touching any code.
Update the "Session log" and "Current state" sections at the end of every session.

---

## 1. What this project is

**Home Network Monitor** — a self-hosted, real-time web dashboard that discovers and monitors every device on a home or small-office network: IP, MAC, vendor, connection duration, bandwidth, and health.

Single-network, single-installation. Not a SaaS. Not multi-tenant in v1.0.

Source of truth for requirements: `docs/PRD.md`.

---

## 2. Non-negotiable constraints

These override any suggestion, convenience, or precedent. If a task appears to require breaking one, stop and ask.

1. **Database: MySQL 8.0+ in production, SQLite in development.** No PostgreSQL. No MongoDB.
2. **No ORM with a binary engine.** Prisma is removed and must not be reintroduced — its binary CDN is unreachable in the sandbox and it forced a PostgreSQL provider. Use the query builder specified in `ARCHITECTURE.md` §4.
3. **Every SQL statement must run on both dialects.** CI runs the suite against MySQL; do not rely on SQLite-only behaviour.
4. **No secret is ever returned by an API route** — not router passwords, not session tokens, not encryption keys. Not even encrypted.
5. **TypeScript strict mode stays on.** No `any` in new code, no `@ts-ignore` without a comment naming the issue it works around.
6. **No new dependency without a line in `docs/ARCHITECTURE.md` §3 saying why.**
7. **Ship working vertical slices.** A feature is done when it runs end-to-end against a live database — not when the UI renders with placeholder numbers.

---

## 3. Stack (as decided, not as currently checked in)

| Layer | Choice |
|---|---|
| Framework | Next.js 15 App Router, React 19 (stable), TypeScript 5.5 |
| Styling | Tailwind CSS 3.4 + hand-authored shadcn/ui-style components on Radix primitives |
| Server state | TanStack Query v5 |
| Forms | React Hook Form + Zod |
| Charts | Recharts |
| Animation | Framer Motion |
| Database | MySQL 8 (prod) / SQLite (dev) |
| DB access | Kysely — typed SQL builder, dialects for both, no codegen binary |
| Drivers | `mysql2` (prod), `better-sqlite3` (dev) |
| Live updates | Server-Sent Events — **not** WebSockets (see `AUDIT.md` A-12) |
| Scheduling | `node-cron` via `instrumentation.ts` |
| Tests | Jest + React Testing Library (unit/integration), Playwright (E2E) |

---

## 4. Current state

**Phase: 5 complete, Phase 6 partially done.** Phases 0–5 are implemented and
verified end-to-end against SQLite; the MySQL leg runs in CI.

- Next.js 15.5 App Router, React 19, Tailwind, Zod config, pino logger
- Kysely 0.28.17 + better-sqlite3 12 / mysql2; 13 tables in 6 migrations
  (`db:migrate` / `db:migrate:down` round-trip verified)
- Scanners: simulated, ARP (capability probe, cached with a 5-minute TTL), ASUS
  (router API, AES-256-GCM credentials, HTTP client under test)
- Auth: bcrypt cost 12, first-run setup, login/logout, middleware allowlist,
  and `lib/api/auth.ts` re-validating the session in every route handler
- Real-time: SSE at `/api/events`, fed by `scanJob`, consumed by
  `useEventStream`, opened once in the dashboard layout
- Alerts: rule engine, activity log, owner scoping enforced in the repository
- Settings: per-user, Zod-validated, persisted
- CI: type-check, build, SQLite suite, MySQL 8 suite, Playwright E2E
- Verified: `type-check` clean · `next build` green · 166 tests pass ·
  85% statements and lines (gate is 70%) · `npm audit` reports 0 vulnerabilities

**Not yet evidenced** — see `doc/TODO.md` § Known follow-ups:

- PRD §5 performance targets are unmeasured; `doc/PERFORMANCE.md` does not exist
- No 24-hour soak
- The E2E specs have never been executed locally (browser CDN unreachable here)
- Multi-instance deployments need a shared rate-limit store

---

## 5. Decisions already made — do not relitigate

| Decision | Rationale |
|---|---|
| Prisma removed | Binary CDN unreachable in sandbox; forced PostgreSQL provider; generated types leaked into React components |
| SSE, not WebSockets | One-directional is sufficient; long-lived `ws` servers do not survive App Router route handlers on standard hosting |
| Kysely over raw drivers | Dual-dialect support with compile-time types; avoids hand-maintaining two SQL variants |
| Byte counters as `BIGINT` in DB, `string` in API | `JSON.stringify` throws on `bigint` (`AUDIT.md` A-05) |
| Multi-tenancy deferred to Phase 6 | No user model exists yet; auth must land first |
| Router credentials AES-256-GCM | PRD §8.2 requirement; currently plaintext |
| The four installer scripts are deleted | `installer-production.sh` scaffolds an unrelated Express app over this one |
| SQLite BIGINT read via `defaultSafeIntegers(true)` | `MysqlDialect` returns byte counters as strings; better-sqlite3 would round a >2^53 counter to a double. Safe-integer mode hands back `BigInt` and the mapper normalises (`Number()` for small ints, `String()` for byte counters, `toBool` uses `Number(value) === 1`) |
| Phase 2 (B-20..B-25) complete | Scanner abstraction with simulated/ARP/ASUS, fallback chain with logging, offline OUI lookup via `oui-data`, cron jobs (scan/rollup/prune) via `instrumentation.ts`, connection event detection diffing scans against known state. All 57 tests pass, build green. |
| Phase 3 (B-30..B-35) complete | Full auth stack: bcrypt users/sessions, first-run setup wizard, login/logout with httpOnly cookies, middleware with allowlist, `requireRole` on all device routes, login rate limiting (5/15min). 80 tests pass, build green. |
| `instrumentation.ts` lives in the **repository root** | Next.js loads it from there or from `src/`, nowhere else. In `lib/` it is an ordinary module that nothing imports, so no job ever runs. The silent failure mode is the reason this is written down. |
| Scanning uses a timer, not a cron expression | `SCAN_INTERVAL_SECONDS` is configurable over 30–3600 and cron cannot express an interval that does not divide 60 (`*/45 * * * * *` is rejected). Rollup and prune keep cron because their schedules are fixed. |
| `register()` guards against double start | Without a `globalThis` guard, every `next dev` hot reload stacks another set of cron tasks and a long session silently multiplies database writes. |
| `normalizeMac` throws on a malformed address | The previous version stripped non-hex characters, so `"not-a-mac"` became `"A:C"` and was written to the database as a phantom device. A rejected row in the scan log beats an undiagnosable ghost. |
| `KNOWN_ALERT_TYPES` is a `const` tuple | `z.enum` needs a tuple to infer the literal union; a plain `readonly AlertType[]` widens to `string` at the route boundary. |
| v8 coverage provider | The default provider records untested files on Windows under keys like `lib/services/file:\\C:\\...\\alertService.ts`, which crashes the lcov reporter. v8 emits clean absolute paths. |
| ts-jest does not type-check (`diagnostics: false`) | `tsconfig.test.json` omits `paths` so Jest's `moduleNameMapper` is the only thing resolving `@/`. Letting ts-jest apply `paths` too loads each module twice on Windows. `tsconfig.json` includes `**/*.ts`, so `npm run type-check` still checks every test file. |
| `postcss` is pinned by an `overrides` entry | Next 15.5.26 depends on `postcss@8.4.31`, which installs a second, vulnerable copy even though the root resolves 8.5.28. The override dedupes it without waiting for a Next major. |
| `/api/setup` is reachable without a session | Necessarily: the first account is the one that grants ADMIN, so gating it would make first run impossible. Safety comes from the 409 once any user exists, a 5/hour rate limit, and a 12-character password policy. |
| Phase 4 (B-40..B-49) and Phase 5 (B-50..B-55) complete | SSE endpoint and event bus with `scanJob` as the producer; `useEventStream` with backoff; device table (14 component tests) and detail page with Recharts; alert engine where one connection raises exactly one alert; activity log; AES-256-GCM router credentials; settings UI. |
| Phase 6 partial (B-60..B-62, B-65) | Playwright specs for the five PRD §7 flows, a four-job CI pipeline (type-check, build, SQLite suite, MySQL suite, E2E), and `doc/DEPLOYMENT.md` + `doc/TROUBLESHOOTING.md` + `Dockerfile`. B-63 (performance) and B-64 (soak) remain unevidenced. |

---

## 6. Known environment limitations

- `binaries.prisma.sh` is unreachable — reinforces the no-Prisma decision.
- Playwright's browser CDN is unreachable in the sandbox. Write E2E specs, but expect them to run in CI rather than locally.
- ARP scanning needs `CAP_NET_RAW`/root. In Docker: `--cap-add=NET_RAW` or `network_mode: host`. The scanner must degrade to router-API or simulated mode rather than crash.

---

## 7. Where things live

```
app/(dashboard)/     authenticated shell — the only owner of /, /devices, /settings, ...
app/api/             route handlers; thin — validate, call a service, shape the response
lib/db/              client, migrations, repositories        <- new, replaces lib/db.ts
lib/services/        business logic; the only layer that touches repositories
lib/services/scanners/  simulated | arp | asus — one interface, three implementations
lib/hooks/           React hooks; server state via TanStack Query only
lib/types/           app-owned domain types (NOT generated)
components/ui/       primitives (button, card, dialog, ...)
components/<Area>/   feature components, directory-scoped
docs/                single source of truth for all project documentation
```

Layering rule: `route handler -> service -> repository -> database`. A route handler must never import a repository directly, and a component must never import a service.

---

## 8. Session log

Append one entry per session. Newest last. Keep entries to three lines.

```
2026-09-24 — Full codebase audit. 20 findings, 4 blockers. Documentation set regenerated
             (PRD, ARCHITECTURE, PLAN, TODO, IMPLEMENTATION, DATABASE, API, TESTING, AUDIT).
             No code changed. Next: B-01 through B-06 (Phase 0).
2026-09-24 — Phase 0 scaffolded from scratch (only doc/ was checked in). Next.js 15 + React 19,
             Kysely 0.27, 6 migrations, repos/services/routes, jest suite. Verified: type-check,
             25/25 tests, next build, migrations up/down. better-sqlite3 bumped 11→12 (v11 crashed
             on Node 24 teardown). Next: prod mysql2 driver + Phase 1 backlog in doc/TODO.md.
2026-09-24 — Phase 1 data foundation (B-10..B-14). mysql2 wired as direct dep; B-11 BigInt end to end
             (batched fetchStatsForDevices, string byte counters in the device DTO, integration test
             proving an exact >2^53 counter over GET /api/devices); B-12 db:seed (12 devices, 7d
             bandwidth, logs, alerts — refuses double-seed); B-13 docker-compose.yml (unverified here);
             B-14 dual-dialect harness (sqlite leg green, mysql leg in CI). 38/38 tests, build green.
2026-09-24 — Phase 2 scanning & bandwidth (B-20..B-25). Scanner abstraction with simulated/ARP/ASUS,
             fallback chain with logging, offline MAC vendor lookup via `oui-data`, cron jobs via
             `instrumentation.ts` (scan loop, hourly rollup, nightly prune), connection event detection
             diffing scans against known state (connected/disconnected events, 2 misses = offline).
             57/57 tests pass, next build green. Next: Phase 3 authentication.
2026-09-24 — Phase 3 auth (B-30..B-35). `users`/`sessions` with bcrypt cost 12, setup wizard,
              login/logout httpOnly cookies, middleware with allowlist, `requireRole` on device routes,
              login rate limit (5/15min). 80/80 tests pass, build green. Next: Phase 4 dashboard.
2026-09-27 — Full-repo review and remediation. The app did not actually run: `/login` and `/setup`
              did not exist, `app/page.tsx` collided with `app/(dashboard)/page.tsx` for `/`, and
              `instrumentation.ts` sat in `lib/` so no scan/rollup/prune job had ever run. The event
              bus had no producer and the alert engine was never called, so SSE carried nothing and
              no alert could fire. Also fixed: encryption that always threw (Web Crypto, 64-hex key
              vs a 32-char dev fallback), a rolled `rollupHourly` (9 columns into 11), bigint
              integers leaking through two repositories, and a `.env local` file with a live MySQL
              password committed under a `.env.*` glob that missed it — that credential needs
              rotating. 166 tests, 85% coverage with a 70% gate, 0 npm audit findings.
              Playwright E2E + 4-job CI added; B-63 performance and B-64 soak still unevidenced.
```
