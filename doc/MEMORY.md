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

**Phase: 0 — Stabilisation.** Foundation scaffolded and building.

The checked-in tree originally held only `doc/` — none of the ~80 source files described in `AUDIT.md` exist, so Phase 0 produced a greenfield scaffold. It now builds end-to-end against SQLite.

- Next.js 15.5 App Router, React 19 stable, Tailwind, zod config, pino logger
- Kysely 0.27 + better-sqlite3 12 (`mysql2` still to come for prod); 13-table schema in 6 migrations (`db:migrate`/`db:migrate:down` verified)
- Device/bandwidth/connection-log repositories + device service, 3 API routes (`/api/health`, `/api/devices`, `/api/devices/[id]`)
- Public landing `/` and authenticated-shell route group `(dashboard)/` at `/dashboard`
- Jest + ts-jest suite wired (`npm test`)
- Verified: `type-check` clean, 25/25 tests pass, `next build` green, migrations up/down round-trip

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
```
