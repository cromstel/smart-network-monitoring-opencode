<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — home-network-monitor

Self-hosted Next.js 16 (App Router, Turbopack) dashboard that discovers and monitors devices on a local network. Node ≥ 20.19 (CI runs 22). Primary dev machine is Windows; CI is Linux.

## Commands

```bash
npm run type-check        # tsc --noEmit — the ONLY lint this repo has (no ESLint)
npm run build             # next build — part of the quality gate
npm test                  # jest; posttest auto-cleans artifacts
npm run test:all          # type-check + test:coverage + build (full local gate)
npm run db:migrate        # apply lib/db/migrations/*.ts (ts-node, tsconfig.node.json)
npm run db:migrate:down   # roll back the last migration
```

- The gate CI enforces: `type-check` → `build` → tests. There is no lint step; do not invent one.
- Perf/soak harnesses demand an explicit throwaway `DB_NAME` and refuse reserved names: `DB_NAME=home_monitor_perf npm run perf`.
- E2E (`npm run test:e2e`, Playwright) runs against `next start`, so it needs a production build in `.next/` first; DB setup via `npm run db:reset:e2e` / `npm run db:seed:e2e` (schema `home_monitor_e2e`).
- DB-backed tests need `RUN_MYSQL_TESTS=1` and must run `jest --runInBand`: suites share one schema and truncate in `beforeEach`, so parallel workers corrupt each other (CI sets this for a reason).

## Test files are deliberately untracked

- `.gitignore` excludes `*.test.ts(x)`, `*.spec.ts(x)`, `__tests__/`, and the local-only `/doc/` and `/thoughts/` directories. A working tree with **no test files** is the expected clean state, and `npm test` passes with none (`passWithNoTests`).
- CI skips its unit/E2E jobs via `hashFiles` guards for the same reason — a skipped job is not a failure.
- `npm run test:clean` (runs automatically as a `posttest` hook) removes artifacts only. `npm run test:purge` deletes the sources from disk — never call it casually; restore with `git show <commit>:<path> > <path>`.
- Do not "fix" missing tests by committing test files: keeping test code out of the remote and out of production images is an explicit repo policy.

## Architecture (authority: `doc/ARCHITECTURE.md`, local-only)

- Layering: `route handler → service → repository → database`; `component → hook → route handler`. Route handlers never import repositories, components never import services, and only `lib/db/client.ts` constructs connections.
- `app/(app)/` is the authenticated shell; `app/api/*` handlers are thin — validate with Zod, call one service, shape the response.
- Database is MySQL-family only: MariaDB 12.3 locally (`docker-compose.yml`), MySQL 8.4 also in the CI matrix. `DB_CLIENT` is always `mysql` — that names the Kysely dialect/driver, not the server brand; `lib/config.ts` rejects any other value. SQLite is gone.
- Cron jobs (scan, rollup, prune, daily summary) live in `instrumentation.node.ts`, loaded through `instrumentation.ts`, which must stay Edge-safe — never import DB/scanner code into `instrumentation.ts` itself. The `globalThis` guard stops `next dev` from stacking a new cron set per hot reload; keep it.
- The CSP is generated **per request** in `proxy.ts` with a nonce + `'strict-dynamic'`. A static CSP in `next.config.ts` broke Next's inline hydration bootstrap before — do not move it back there. `next.config.ts` holds only genuinely static headers.
- Every port and the dev-origin allowlist come from `lib/config/ports.ts` (single source; the default `PORT` lives there too).

## Environment — no credential defaults, ever

- The process refuses to boot without `SESSION_SECRET` and `ENCRYPTION_KEY` (32+ chars each) and `APP_NAME` (white-labeling; read per request via `appName()` because `app/layout.tsx` is `force-dynamic`). CI supplies throwaway values — copy them from `.github/workflows/ci.yml` for local runs, or copy `.env.example` → `.env`.
- A pre-commit hook (`npm run hooks:install`) blocks any staged `.env*` file. A real password was leaked this way; keep the hook installed and never bypass it.
- `package.json` `overrides` pin transitive CVE fixes; every entry is justified in the `//overrides` comment block. Do not remove one without replacing its advisory fix.

## Windows / tooling gotchas

- Jest uses ts-jest with `diagnostics: false` and the v8 coverage provider because babel/istanbul mangles Windows paths in coverage (`file:\C:\...` keys crash lcov). `tsconfig.test.json` deliberately omits `paths` — Jest's `moduleNameMapper` is the only `@/` resolver; type safety still comes from `npm run type-check`.
- Use `127.0.0.1`, not `localhost`, for test/db hosts: Windows resolves `localhost` to `::1` first and misses IPv4 listeners.
- No ESLint/Prettier config exists — match surrounding style manually.

## Docs map

- Tracked: `API.md` (endpoint reference — update it when you add or change a route), `SECURITY.md` (env-variable contract and reporting policy).
- Untracked/local-only under `doc/`: `ARCHITECTURE.md`, `TESTING.md`, `DEPLOYMENT.md`, `TROUBLESHOOTING.md`, `PRD.md`, `TODO.md`. `doc/PERFORMANCE.md` and `doc/SOAK.md` are regenerated by harnesses; do not hand-edit or commit them.
