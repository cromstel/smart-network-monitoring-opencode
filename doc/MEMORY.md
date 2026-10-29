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

1. **Database: MariaDB 12.3 (development server and the bundled Compose stack) and MySQL 8.4 (deployed container stack).** No PostgreSQL, no MongoDB, and no other engine — both supported servers are MySQL-family and are reached through the same driver. The two speak the same protocol, so DB_CLIENT=mysql names the *driver* (Kysely MysqlDialect over mysql2), not the server.
2. **No ORM with a binary engine.** Prisma is removed and must not be reintroduced — its binary CDN is unreachable in the sandbox and it forced a PostgreSQL provider. Use the query builder specified in `ARCHITECTURE.md` §4.
3. **Every SQL statement must run on both dialects.** CI runs the suite against MariaDB; do not rely on SQLite-only behaviour. **This constraint was satisfied on paper and violated in practice for weeks** — see §5.
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
| Database | MariaDB 12.3 (dev server) / MySQL 8.4 (deployed stack) / SQLite (tests) |
| DB access | Kysely — typed SQL builder, dialects for both, no codegen binary |
| Drivers | `mysql2` (prod), `better-sqlite3` (dev) |
| Live updates | Server-Sent Events — **not** WebSockets (see `AUDIT.md` A-12) |
| Scheduling | `node-cron` via `instrumentation.ts` |
| Tests | Jest + React Testing Library (unit/integration), Playwright (E2E) |

---

## 4. Current state

**Phase: 5 complete, Phase 6 partially done.** Phases 0–5 are implemented and
verified end-to-end against **both** dialects, not just SQLite.

- Next.js 16.4.2 App Router (Turbopack), React 19.3, Tailwind, Zod config, pino logger
- Kysely 0.28.17 + better-sqlite3 12 / mysql2; 13 tables in 7 migrations
  (`db:migrate` / `db:migrate:down` round-trip verified)
- Scanners: simulated, ARP (capability probe, cached with a 5-minute TTL), ASUS
  (router API, AES-256-GCM credentials, HTTP client under test)
- Auth: bcrypt cost 12, first-run setup, login/logout, proxy allowlist,
  and `lib/api/auth.ts` re-validating the session in every route handler
- Real-time: SSE at `/api/events`, fed by `scanJob`, consumed by
  `useEventStream`, opened once in the dashboard layout
- Alerts: rule engine, activity log, owner scoping enforced in the repository
- Settings: per-user, Zod-validated, persisted **and consumed** — since
  `dd9c5de` the saved subnet, scan interval, retention and notification toggles
  are resolved at runtime (`runtimeSettings`, `notificationPreferences`) instead
  of the process environment only
- Bandwidth: `bandwidthService` differences the routers' cumulative counters into
  `bandwidth_metrics` on every scan, and the configured bandwidth rule fires
  (F-20…F-24, F-31)
- Hostname fallback: reverse PTR lookup for devices the router did not name (F-03)
- Theme: `ThemeSync` renders the stored preference as a `.light` class (F-53)
- Routes: `/` overview · `/devices` list · `/devices/[id]` · `/alerts` · `/settings` · `/auth/login` · `/auth/setup`
- Retired paths, all 308: `/login` · `/setup` · `/overview`
- CI: type-check, build, SQLite suite, **MariaDB 12.3 + MySQL 8.4** matrix, performance (also a two-engine matrix), Playwright E2E
- Verified: **CI was 8/8 green** on 2026-10-02, the first green run in the
  repository's history — **213 tests on each of SQLite, MariaDB 12.3.3 and MySQL
  8.4.11, in CI** · **19/19 Playwright in CI** · **15/15 PRD §5 performance
  measurements pass on all three engines, in CI** · FCP p95 **316ms** against a
  2s target (`scripts/fcp.ts`, 2026-10-04). CI has since been blocked by account
  billing, so those figures are the last CI-verified state, not current.
  `npm audit --omit=dev` reports 0 production vulnerabilities — the three that
  remained after the Next 16 upgrade (seroval via solid-js, and source-map-js)
  were cleared by overrides in `package.json`. The dev-only toolchain still
  carries 41 advisories, all under Jest 29 and Tailwind 3 and their transitive
  dependencies; clearing those means major upgrades to Jest 30 and Tailwind 4,
  which is its own migration, not part of a framework bump.

**Not yet evidenced** — see `doc/TODO.md` § Known follow-ups:

- **GitHub Actions billing is blocking every run** (since 2026-10-03). Jobs fail
  in 2–13s with "recent account payments have failed or your spending limit needs
  to be increased" and no step executes. Account-level, not code. Until it is
  fixed nothing is verifiable in CI, and these runs must not be read as test
  failures — that is exactly how a billing problem gets mistaken for a regression.
- A single-process 24-hour soak; the segmented pipeline is verified green
- The real ARP `/24` probe is unmeasured (needs `CAP_NET_RAW` and a live subnet)
- The app has never run against a MySQL dataset that predates the column change
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
| `instrumentation.ts` lives in the **repository root** | Next.js loads it from there or from `src/`, nowhere else. In `lib/` it is an ordinary module that nothing imports, so no job ever runs. |
| Scanning uses a timer, not a cron expression | `SCAN_INTERVAL_SECONDS` is configurable over 30–3600 and cron cannot express an interval that does not divide 60 (`*/45 * * * * *` is rejected). Rollup and prune keep cron because their schedules are fixed. |
| `register()` guards against double start | Without a `globalThis` guard, every `next dev` hot reload stacks another set of cron tasks and a long session silently multiplies database writes. |
| `normalizeMac` throws on a malformed address | The previous version stripped non-hex characters, so `"not-a-mac"` became `"A:C"` and was written to the database as a phantom device. |
| `KNOWN_ALERT_TYPES` is a `const` tuple | `z.enum` needs a tuple to infer the literal union; a plain `readonly AlertType[]` widens to `string` at the route boundary. |
| v8 coverage provider | The default provider records untested files on Windows under keys like `lib/services/file:\\C:\\...\\alertService.ts`, which crashes the lcov reporter. |
| ts-jest does not type-check (`diagnostics: false`) | `tsconfig.test.json` omits `paths` so Jest's `moduleNameMapper` is the only thing resolving `@/`. |
| `postcss` is pinned by an `overrides` entry | Next 15.5.26 depends on a second, vulnerable `postcss` copy. The override dedupes it without waiting for a Next major. |
| Weekly vulnerability scan + safe auto-fix (system cron) | `scripts/weekly-audit-fix.mjs` runs `npm audit --audit-level=high --json`, applies `npm audit fix`, exits 0/1/2; `weekly-audit` script + `cron-weekly-audit.txt` (`0 2 * * 1`). First run verified exit 0 / audit 0; no secrets in logs; `zod` `^3.23.8` → `^4.6.7` handled (lib/config.ts filter); audit-plan naming preserved (`plan-YYYY-MM-DD.md`). |
| `/api/setup` is reachable without a session | Necessarily: the first account is the one that grants ADMIN, so gating it would make first run impossible. Safety comes from the 409 once any user exists, a 5/hour rate limit, and a 12-character password policy. |
| **Timestamps are `varchar(64)`, never `datetime`** | Every timestamp is an ISO-8601 UTC string from `toISOString()`, which is what `schema.ts` declared all along. A `datetime` column looks fine on SQLite — it stores the text without complaint — and fails every write on MariaDB, which rejects the `T`/`Z` format outright. Declaring the columns as text makes both dialects agree and matches the types the code already used. The alternative (a real DATETIME plus a dialect-aware conversion on every write) would make mysql2 return `Date` where SQLite returns `string`, contradicting every `string` in `schema.ts`. Full explanation at the top of `lib/db/migrator.ts`. |
| **Upserts branch on dialect** | Kysely's `onConflict()` compiles to `on conflict (...) do update set`, which is not valid MySQL. MySQL wants `on duplicate key update` and takes the conflict target from the unique key instead of naming a column. MySQL also has no `excluded` pseudo-table, so `excluded.col` becomes `values(col)`. |
| **Hours are bucketed with `SUBSTR(col, 1, 13)`** | The first 13 characters of a fixed-width ISO-8601 UTC string are `YYYY-MM-DDTHH`, and because the format is fixed and UTC they sort lexicographically in chronological order. `DATE_FORMAT`/`strftime` were dialect-specific *and* broke on MariaDB, because they made the server coerce the string to a DATETIME. This is now one expression that needs no branch. |
| **A report filename keyed on `DB_CLIENT` cannot tell two engines apart** | Benchmarking MariaDB 12.3 overwrote the MySQL 8.4 numbers, because `reportPathFor('mysql')` produced the same path for both — `DB_CLIENT=mysql` names the *driver*, and both servers arrive over it. The report path is now keyed on the engine, taken from the server's own `VERSION()`, which is also recorded inside each report. This is the same lesson as the CI "confirm the engine under test" step, one layer up: a number that cannot say what produced it cannot be checked. |
| **A SQLite-only benchmark is a benchmark of the engine nobody deploys** | The perf harness could not run against MySQL at all: `assertDisposableDatabase` hard-required `DB_FILE`, which is meaningless on a server, so the MySQL leg was unreachable rather than merely unrun. Throwaway detection is now dialect-aware — a file on SQLite, a schema name on MySQL, with the live schema names refused outright. Measured result worth keeping: **SQLite is the slowest engine on the stats fan-out** (192.7ms vs 17.0ms on MySQL, 6.7ms on MariaDB) and the only one within 20% of its budget, because that query is a correlated subquery over the whole metrics table. It wins the history query and the device list. "In-process is faster" is false for the query the dashboard runs most. |
| **The MariaDB CI job runs `--runInBand`** | Not a performance choice. Suites share one database and each truncates tables in its `beforeEach`; SQLite gives every worker a private `:memory:` database so they cannot collide, MariaDB does not. In parallel, workers wiped each other's fixtures and failure counts swung between 13 and 39 on identical code. |
| **A pre-commit hook blocks env files** | An ignore rule is only as reliable as the file containing it: the `.gitignore` working copy was twice silently reverted from the `.env*` glob to a literal `.env`/`.env.*` pair, after which a file with a live password was both untracked *and* unignored. Versioned at `scripts/git-hooks/`, installed with `npm run hooks:install`, deliberately not wired to `postinstall`. |
| **Client disconnects are swallowed at the process level** | A browser closing a tab aborts in-flight requests; Node reports that asynchronously, from the HTTP layer, as `uncaughtException: [Error: aborted] { code: 'ECONNRESET' }`, and Next.js's handler logs and exits. Node invokes *every* uncaughtException listener, so returning early from one cannot suppress the others — only a capture callback takes exclusive control. The filter is deliberately narrow (disconnect signatures only) and rethrows everything else, because a blanket catch would turn every future bug into a silent mystery. Reproduced with the EventSource disabled, so it was never the SSE stream. |
| Phase 4 (B-40..B-49) and Phase 5 (B-50..B-55) complete | SSE endpoint and event bus with `scanJob` as the producer; `useEventStream` with backoff; device table and detail page with Recharts; alert engine where one connection raises exactly one alert; activity log; AES-256-GCM router credentials; settings UI. |
| Phase 6 partial (B-60..B-62, B-65) | Playwright specs for the PRD §7 flows, a six-job CI pipeline, and `doc/DEPLOYMENT.md` + `doc/TROUBLESHOOTING.md` + `Dockerfile`. B-63 (performance) is now benchmarked on all three engines; B-64 (soak) remains unevidenced. |

| **Id columns are `varchar(36)`, never `uuid`** | `uuid` is a MariaDB data type (10.7+). MySQL has no equivalent and rejects the column outright, so the schema could not be created on MySQL at all — every migration died at the first CREATE TABLE. `varchar(36)` is what the code already assumed: every id in `schema.ts` is `string`, every id comes from `randomUUID()`, and MariaDB's native uuid type stores exactly that — 36 bytes of text, read back unchanged. Same reasoning as the timestamp columns. |
| **Authentication pages live under `/auth/*`** | `/login` and `/setup` became `/auth/login` and `/auth/setup`, so every unauthenticated entry point is under one prefix rather than sitting loose at the root next to real application routes. The API routes keep their own `/api/*` namespace and are unchanged — `/api/auth/login` and `/api/setup` are endpoints, not pages, and moving them would break clients for no gain. The middleware allowlist and every redirect target were updated together; missing one produces a redirect loop, because `/login` is no longer a route and an unauthenticated visitor bounced there would hit a 404 instead of a login form. `/login` and `/setup` are 308-redirected to the new paths so existing bookmarks keep working; those redirects are a compatibility shim and can be dropped once nobody holds an old link. |
| **"Warm cache" means the context must outlive the loads** | The first FCP harness created a fresh browser context per load, so every "warm" sample had an empty HTTP cache and was really cold. Only the OS page cache and the JIT carried over, so it measured neither cleanly warm nor cleanly cold — and it still produced a plausible-looking p95 of 1.56s, which is what let it survive a second run. The tell was not a failing test but a number that did not look like a warm number. One context now outlives every load, and the cold/warm split became visible (440ms → 188ms). A metric harness needs its own plausibility check: ask whether the distribution looks like the thing being measured, not only whether the gate passes. |
| **A gate that cannot pass is not a gate, it is a skip** | "Confirm the engine under test" tested `VERSION().includes('mysql')`. MySQL 8.4 reports `8.4.11` — the word MySQL appears only in `@@version_comment`. So the check failed, the MySQL job refused to run its own tests, and the run was reported as a MySQL *failure* rather than as the coverage gap it was. MariaDB self-identifies, which is why only that leg worked and why B-14 could be ticked "both green" with one leg never run. Now one script checks both `VERSION()` and `version_comment`, and also refuses if it finds the *other* engine, since the two share a wire protocol. The general rule: a check whose failure is indistinguishable from a real failure is worse than no check, because it hides the gap it was added to expose. |
| **GitHub kills a job at 6 hours, so a 24h soak is not a configuration problem** | The nightly soak had never produced a report, and the log says why: *"The job has exceeded the maximum execution time of 6h0m0s"*. `timeout-minutes: 1560` and `SOAK_MINUTES=1440` cannot override it. The design was unrunnable, not unlucky. Four sequential ~330-minute segments plus a verdict job now cover the wall clock, with the report stating it is a segment and what segmentation does not prove. |
| **Valid YAML is not a loadable workflow** | `${{ (a || b) * 4 / 60 }}` is valid YAML and invalid GitHub — the expression language has no arithmetic, and the file is rejected at dispatch with `Unexpected symbol: '/'`. Reading a workflow back with a YAML parser proves it parses as YAML and nothing more. Dispatch it. |
| **A `?redirect=` param is untrusted input, not a path** | The middleware sets `?redirect=` to the path it denied, so a deep link survives the login detour — and the login page handed that value to `router.replace()`. That is an open redirect: a link to `/auth/login?redirect=https://attacker/` navigates the victim off-origin *after* they authenticate, with a live session. Measured rather than assumed — the probe produced `chrome-error://chromewebdata/`, which looks like a harmless failure but is just a host that does not resolve; a real one renders. `safeRedirect()` in `lib/utils/redirect.ts` accepts same-origin paths only. The subtle cases are the ones worth naming: `//host` and `/\host` are *authorities*, not paths, and `/\` is normalised to `//` by some browsers, so a check that only rejects `http://` passes both. Next.js happened to neutralise `//host` already, but relying on a framework's incidental behaviour is how an open redirect survives a dependency bump. |
| **Both database engines are tested, and neither job is allowed to cancel the other** | MariaDB 12.3 is the development server; MySQL 8.4 is what the deployed container stack runs. Testing one means half the real deployments are untested, which is how B-14 came to be ticked "both green" while the MySQL leg had never run and could not have. `fail-fast: false`, plus a step that prints `VERSION()` and fails if it does not match the matrix entry, so a green run cannot be silently the wrong server. |
| **The E2E server is never reused** | The webServer command resets and seeds before starting, so a reused server skips that and serves whatever database it happened to hold. The failure mode is silent rather than loud: a run against a stale server reported 6 of 17 specs, took three times as long, and explained nothing. Slower local iteration, correct results. |
| **Next.js 16 renames the `middleware` convention to `proxy`** | `middleware.ts` became `proxy.ts` and the exported `middleware` function became `proxy`. The proxy runtime is Node.js and is no longer configurable, which is why `export const runtime = 'nodejs'` is gone from the file. That runtime is load-bearing here, not incidental: `validateSession` opens the application database through the same repository layer the routes use, so an Edge runtime could not reach it. Next 16 also makes Turbopack the default bundler, which is what removed the `node:child_process` `UnhandledSchemeError` that the old webpack dev build hit on `lib/services/scanners/arpScanner.ts`. No webpack config exists in `next.config.mjs`, so the default applies. |
| **The instrumentation hook is split by runtime** | Next.js compiles `instrumentation.ts` for every runtime it builds for, Edge included. Statically importing the boot graph there (better-sqlite3, `node:child_process`, `node:fs`, the scanners) dragged all of it into an Edge compilation and produced eleven "A Node.js module is loaded ... not supported in the Edge Runtime" warnings on every build. The Node-only work now lives in `instrumentation.node.ts`, reached by a conditional `await import()` inside `register()` - the pattern Next documents, and the import is dead code on Edge because `NEXT_RUNTIME` is inlined to a literal per compilation. `app/api/health` imports `getSchedulerStatus` from the node file directly; re-exporting it through the hook would recreate the very static import the split removes. The disconnect guard is still installed at module load (now the node file's, which is evaluated during `register()`, before the server accepts requests) rather than inside `registerNode()`, because the abort it defends against is reported by the HTTP layer. |
| **A `PATCH` body is assembled key by key, never spread** | Both repositories decide what to write with `'key' in patch` — a precise test that a key *present* passes even when its value is `undefined`. So `PATCH { isActive: false }` written as `{ deviceId: parsed.deviceId, isActive: parsed.isActive }` matches on `deviceId` and writes `null`: a per-device alert rule silently became a global one, and an empty body became an `updated_at`-only write reporting success. Confirmed by reverting the fix — `device_id` came back `null` — before the guard was pinned in `api.alerts.integration.test.ts`. Zod v3 omits absent optional keys, which is what makes the `in` check correct; a spread would defeat it. |
| **`DELETE /api/alerts/{id}` accepts ADMIN *and* MEMBER, and stays owner-scoped** | The handler demanded ADMIN outright, contradicting both the role table ("manage own alerts") and API.md ("owner or ADMIN"). Widening the role list does not widen the query: the `where user_id = ?` stays, so even an ADMIN deleting another account's rule gets 404 and the row survives. That is asserted directly, because the interesting failure is the one where a broader role silently becomes a cross-user path. Owner-scoped writes are what keep PRD F-34 true after F-20 (private per-account rules) has landed. |
| **`POST /api/alerts` rejects `bandwidth_exceeded` with no threshold** | API.md has always marked the field required for that type, and nothing enforced it. A rule stored without one can never fire — it exists, appears in the list, and does nothing, which is worse than a validation error because only the user can tell. The symmetric case (a threshold on `unknown_device`, which has no use for one) is rejected too, so the field means "this rule type reads it" rather than "sometimes present". |
| **UI permissions fail *open* for `canManage`, *closed* for `isAdmin`** | Both fields are `undefined` while `GET /api/auth/me` is in flight or has failed, and they must not agree. Failing `canManage` closed hid the entire alert-rule form behind a network request and would have hidden it permanently had that request ever failed — a cosmetic nicety costing a whole feature, and it made the control set depend on a race (an E2E spec counts delete buttons before the role arrives and gets a different number than after). `canManage` governs the caller's own resources and the handler re-checks the session anyway (F-62), so defaulting to "show it" costs nothing. `isAdmin` governs global state, where guessing "yes" flashes a control that then vanishes — so that one defaults to "hide". |
| **Phantom endpoints are documented as non-implementations, not built** | B-70. `API.md` described `POST /api/devices/scan`, `DELETE /api/devices/{id}`, `/api/bandwidth/*` and the router `test`/`status`/`block` routes as if they existed. Building them would have added endpoints with no producer (the scheduler already scans) and no consumer (`/api/overview` already returns the bandwidth data), and a device-deletion route that repopulates on the next passive scan. The doc now states each absence and the reason beside it, which is checkable, instead of leaving a reader to discover the 404. Two gaps *were* implemented because they were half-present: `GET /api/auth/me` (the UI needed it) and `PATCH /api/devices/{id}` accepting `categoryId`/`isIgnored` (its own example always promised them). |
| **A search assertion must name a term no scanner can invent** | The devices spec typed "NAS" and expected the other devices to disappear. `searchFilter` matches name, hostname, IP *and* MAC, and while the seed writes `ana-s-iphone`, the running simulated scanner rewrites it to `anas-iphone` — which contains "nas". So the spec passed early in a run and failed once the scanner caught up: an outcome that depended on server uptime, measured failing 5 of 8. Two wrong theories were chased first and both are recorded because each *reproduced*: React's value tracker under Playwright's `fill()` (the DOM value was correct in every failure), and a data-layer concurrency bug that reproduced 120/180 times — disproved by a raw query agreeing while the "expected" counts were silently computed against 5 seeded devices when the database held 12. The fix was one search term. Rule: when a test fails intermittently and the endpoint "looks right", print what the endpoint actually returned before changing the test or the code. |
| **A baseline read from a loading panel is always zero** | The alerts spec read `deleteButtons.count()` for a baseline, but the panel renders "Loading…" with zero delete buttons until its query resolves, so the baseline was 0 however many rules existed and every count assertion inherited a race with the request. Same shape as the role-gating race that hid the form until `/api/auth/me` answered. `beforeEach` now waits for "a rule row **or** the empty state" before any spec reads a count — the distinction matters, because waiting for a row alone would hang on a legitimately empty account. |
| **A "hidden for this role" assertion must first prove the role arrived** | The E2E seed creates one account per role, and every role-gating check waits for the sidebar to echo the role before touching the DOM. Without that anchor both directions are meaningless: `canManage` fails *open*, so a VIEWER's controls are rendered for as long as `/api/auth/me` is in flight and "Edit is hidden" would pass because nothing had loaded yet; `isAdmin` fails *closed*, so "Save changes is visible" as ADMIN is a race the spec can lose. The layout and the page share one react-query entry (`['auth','me']`), which is what makes the sidebar text a sound loaded signal for both. A negative assertion that never established its precondition proves nothing — the same lesson as the zero baseline above, pointed the other way. |
| **An endpoint matrix cannot detect a missing producer** | Every requirement above was "served": the route existed, the page rendered, the unit test passed. What did not exist was anything that *wrote* the data — `insertBandwidthMetric` had no production caller, `evaluateBandwidthThreshold` had no caller at all, and the settings columns had no reader. A completeness audit built from routes and responses is structurally blind to this, because it examines the surface between client and server and never the one between server and database. The check that finds it is tracing a value forward from its writer to its reader, and when that fails, asking which half is missing: the producer or the consumer. Five of the six defects in the 2026-10-20 audit were one of those two halves. |
| **A settings value must be resolved where it is used, not once at boot** | Reading the scan interval once in `register()` would mean a changed interval does nothing until the process restarts — the same "write-only setting" defect with an extra step in between. The scheduler re-resolves per tick, and `scanOnce` resolves the subnet and notification toggles at the moment it scans. The cost is a settings read per cycle against a scan that already runs every 30s, which is not a cost. `getEffectiveScanSettings()` is also total: a failed read logs and returns the environment value, because a settings lookup that can throw would let a preferences table take down network monitoring. |
| **Notification toggles are per rule owner, and fail open** | The three toggles live in `user_settings`, one row per user, but an alert belongs to a rule, which belongs to a user. A single global read would mute one account's alerts because another account unchecked a box. `isNotificationEnabled(type, ownerId)` resolves against the owner; a missing row means "alert", matching `permissionsFor.canManage`: an alert that never fires is invisible and therefore unfixable, while a redundant one is merely annoying. |
| **Cumulative counters must be differenced over measured elapsed time, with a floor** | Routers report lifetime bytes, so a rate is `Δbytes / Δt` and both halves matter. Dividing by the *configured* interval rather than the actual gap reports a fiction whenever a scan is fast; a scan that returns in 20ms over a real delta reports thousands of Mbps that no link could carry — and that number then drives the bandwidth alert. Elapsed is floored at 2s. The first observation writes nothing (a rate from one reading is the device's lifetime total over one interval, an enormous phantom spike), and a negative delta is a counter reset (router reboot) so the sample is skipped and the baseline re-taken rather than recorded as a negative rate. |
| **Two `queryFn`s under one react-query key is a silent type confusion** | `['settings']` was fetched by the settings page as `{ data: Settings }` and by the layout as a bare theme string. React Query caches by key alone and cannot know the two call sites meant different shapes, so whichever mounted first defined the cached shape for the other. When the settings page won, the layout received an object where it expected a string, applied nothing, and the theme appeared to require a reload. Nothing throws, no type-check catches it (each `queryFn` is independently well-typed), and the only symptom is a feature that works sometimes — depending on mount order. Sharing a key means sharing the fetcher. |
| **A pre-paint script must not be part of the tree React compares** | A raw inline `<script>` in the layout runs before paint as intended, but remains a node React reconciles, so the `class` it adds makes the hydrated DOM differ from the server HTML — React error #418 (text-content mismatch) — and the whole hydrated tree is discarded. `next/script` with `strategy="beforeInteractive"` is hoisted into the head and runs outside reconciliation. This was invisible to unit tests and to the build; it surfaced only because the E2E fixture hooks `pageerror`. |
| **A theme test must assert the rendered document, not the stored value** | A unit test on `theme` passed for months while the app rendered a hardcoded dark palette, because it checked the column, and the column was always correct. The E2E spec asserts the `light` class on `<html>` after save, across a reload, and — because a no-op class would satisfy both — that the computed background actually gets lighter. That last assertion is the one that distinguishes "the switch is wired" from "the switch does something". Writing the spec this way immediately exposed the two defects above, neither of which any amount of code reading had caught. |
### The lesson from B-14 and B-60

Two items were ticked off as complete on the strength of a claim nobody
executed: "dual-dialect tests — both green in CI", and "E2E runs in CI". Both
had never run. SQLite is permissive in ways MySQL is not (it stores any text in
a `datetime` column, any text in a `uuid` column, and gives each Jest worker a
private database), so an entire class of production-breaking defects stayed
invisible behind a green SQLite run.

**A tick in this file is a claim to be verified, not a summary of intent.** Run
the thing.

---

## 6. Known environment limitations

- `binaries.prisma.sh` is unreachable â€” reinforces the no-Prisma decision.
- **Playwright's browser CDN is now reachable** (2026-09-27). The E2E suite runs
  locally; the old "expect them to run in CI" note no longer applies.
- **Two engines are in play.** MariaDB **12.3.3** is the Windows-local server
  `.env.local` points at. MySQL **8.4.11** is what the live container stack
  `smart-network-monitoring-app-1` runs (compose project
  `smart-network-monitoring`, file at
  `/mnt/c/projects/smart-network-monitoring/docker-compose.yml`, database
  `smart_home_monitor`). CI tests both. The `docker-compose.yml` in this repo
  uses MariaDB.
- They are not interchangeable, which is precisely why both are tested. MySQL
  has no `uuid` type, so the id columns had to become `varchar(36)` before the
  schema would exist there at all. Their default collations also differ
  (`utf8mb4_uca1400_ai_ci` vs `utf8mb4_0900_ai_ci`), which is why compose pins
  the character set but leaves the collation to the server.
- MySQL 8.4 defaults to `caching_sha2_password`. mysql2 negotiates it with no
  extra configuration, verified by connecting and writing over the wire.
- Docker lives on WSL, not on the Windows PATH. Reach it with
  `wsl -e bash -lc "docker ..."`; there is no `docker` command directly.

- `DB_CLIENT=mysql` is retained everywhere and means the *driver* (Kysely
  `MysqlDialect` over mysql2), not the server. MariaDB is reached through it.
  `lib/db/client.ts` says so at the branch point, because a config key called
  `mysql` sitting next to a container called `mariadb` otherwise reads like a
  bug.
- MariaDB's default collation is `utf8mb4_uca1400_ai_ci` (Unicode 14.0), not
  MySQL 8's `utf8mb4_0900_ai_ci`. `docker-compose.yml` pins the character set
  but leaves the collation at the server default, so local development matches
  production instead of quietly disagreeing with it.
- The `monitor` user has full privileges on `home_monitor` and
  `home_monitor_test` only â€” it cannot `CREATE DATABASE`, so a fresh test
  schema must be produced by dropping tables, not by creating a database.
- ARP scanning needs `CAP_NET_RAW`/root. In Docker: `--cap-add=NET_RAW` or
  `network_mode: host`. The scanner must degrade to router-API or simulated
  mode rather than crash.


## 7. Where things live

```
app/(app)/            authenticated shell — owns /, /devices, /devices/[id], /alerts, /settings
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
             B-14 dual-dialect harness (sqlite leg green, mariadb leg in CI). 38/38 tests, build green.
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
              no alert could fire. Also fixed: encryption that always threw, a rolled `rollupHourly`,
              bigint integers leaking through two repositories, and a `.env local` file with a live
              MySQL password committed under a `.env.*` glob that missed it.
2026-09-27 — Credential purge and performance/soak harness. `git filter-repo` removed `.env local`
              from all history, force-pushed with `--force-with-lease`, verified no blob in the object
              store still contains the password. `scripts/perf.ts` and `scripts/soak.ts` added with
              p95 gates and fault injection. Playwright added but never actually run — the seeding
              step in `e2e/global-setup.ts` was not wired into the config.
2026-09-28 — The E2E suite was made to run at all, and it immediately reported six real defects.
              Nobody could log in (SQLite returns integers as bigint, so `is_active === 1` was
              always false); the dashboard threw on every render (flat `DeviceDTO` vs nested
              `EnrichedDevice`); closing a tab could kill the server; the rename dialog could not be
              opened; renames appeared not to save; the bandwidth chart fetched a route that did not
              exist. 17/17 specs green afterwards.
2026-09-29 — "Complete all pending tasks" turned out to mean "the backlog was fiction". B-14 claimed
              a green database leg that had never run. Running it found five defects: `datetime`
              columns rejected every MySQL write, `onConflict` emitted SQLite syntax, the rollup's
              `DATE_FORMAT` crashed, parallel Jest workers shared one database, and a fixture used a
              non-UUID primary key. B-60 claimed a passing E2E suite that had never run. Also fixed a
              regression from the prior session, where the overview page had overwritten the device
              list at `/`. 198/198 on both dialects, 17/17 E2E, zero uncaught exceptions.
2026-10-01 — Route restructure. The device list sat at `/` while only `/devices/[id]` existed, so `/devices`
              404'd and the landing page was a table. The overview now owns `/` and the list is `/devices`;
              `(dashboard)` became `(app)`; `/overview` 308-redirects alongside the `/auth/*` shims. Moving the
              list is what surfaced the open redirect in `?redirect=`, fixed via `safeRedirect()`. Two E2E
              tests were fixed by *using* the `signIn` helper rather than re-adding a wait — navigating
              straight to `/devices` after clicking Sign in raced the cookie being set. 207/207 Jest on
              SQLite, MariaDB 12.3.3 and MySQL 8.4.11, 19/19 E2E, plus a full route/redirect matrix run
              against a production build.
2026-10-01 — Performance on all three engines (B-63). The harness could not run against MySQL at all:
              `assertDisposableDatabase` required `DB_FILE`, and the report path was a fixed
              `doc/PERFORMANCE.md` so the second engine measured erased the first. Throwaway detection is now
              dialect-aware and each engine writes its own report, keyed on `VERSION()` rather than on
              `DB_CLIENT` — keying on the dialect was tried first and observably overwrote MySQL 8.4 with
              MariaDB 12.3. 15/15 measurements pass on SQLite, MySQL 8.4.11 and MariaDB 12.3.3. Finding worth
              keeping: SQLite is the *slowest* engine on the stats fan-out (192.7ms vs 17.0ms / 6.7ms), the
              query the dashboard runs most, and the only engine within 20% of its budget. A test now checks
              the hand-written index against the generated reports; both its assertions were confirmed to fail
              when the index is broken. CI gained a two-engine performance matrix. 211/211 Jest on all three
              engines, 19/19 E2E, build clean.
2026-10-02 — Read the CI run history, and found that *every run had failed*. The first green run is this
              one, and getting there meant fixing four real bugs, three of them pre-existing and invisible
              because nothing had ever run: the engine check could not pass for MySQL (so that leg had
              never executed once); the performance job's MariaDB container never started (hardcoded
              mysqladmin health command); the E2E job had no `next build`, so it died before running a
              single spec (invisible locally because .next already existed); and my own perf-index test from
              the previous commit threw ENOENT in CI because `describe.skip` still runs its callback. Fixing
              the E2E job also exposed a product bug: device search was a case-sensitive `LIKE`, so `nas`
              found "NAS Server" on SQLite and nothing on MySQL 8.4. Both sides are now lowercased and LIKE
              metacharacters are escaped. Then the soak: GitHub cancels jobs at 6h, so the 24-hour design
              was unrunnable rather than pending — now four sequential segments with a verdict job, and the
              report says it is a segment. Result: 8/8 CI green, 213/213 Jest on all three engines in CI,
              19/19 E2E, 15/15 performance measurements on all three engines.
2026-10-04 — Measured first contentful paint, the last PRD §5 target with no evidence behind it
              (`scripts/perf.ts` disclaimed it because a paint event is a browser fact, not a server one).
              p95 316ms against the 2s target, 16% of budget, on the 100-device dataset. Two methodology
              errors of my own, both caught by reading the numbers rather than by a failing test: a fresh
              browser context per load made every "warm" sample genuinely cold (p95 first read 1.56s), and a
              swallowed 409 from /api/setup turned into a 30s login timeout with no explanation. Gate
              confirmed to fail by aiming it below the measured median. Separately: GitHub Actions billing
              began failing every job on 2026-10-03 with "recent account payments have failed or your
              spending limit needs to be increased" — 2–13s per job, no step executed. Account-level, not
              code, and worth naming because a billing outage looks exactly like a failing test run.
2026-10-16 - PayStack billing (B-67). Four credential columns added to `user_settings` by a new migration
             `007_paystack_billing.ts` rather than by editing 005, because Kysely never re-runs an applied
             migration and an edit would therefore reach only fresh databases. `GET /api/settings` returns a
             redacted view carrying `paystackSecretSet`/`paystackAccessTokenSet` booleans instead of the
             values, and the settings form posts only non-empty fields, so an untouched input cannot blank a
             stored credential. `SECURITY.md` policy template and `paystack-integration.yml` added.
2026-10-16 - Upgraded to Next.js 16.4.2 + React 19.3.1 (latest stable) following the v16 upgrade guide.
             `middleware.ts` became `proxy.ts`; the runtime is Node.js now and no longer configurable, which
             is fine because it was already declared `nodejs` - the session check opens the application
             database, so an Edge runtime could not run it. The rest of the breaking-change survey found
             nothing to migrate: routes already used async `params`, `cookies()` was already awaited, and
             there is no `next/image`, `revalidateTag`, AMP, parallel route or ESLint here (so the `next lint`
             removal is moot). Turbopack is the default in 16 and that alone fixed the `node:child_process`
             `UnhandledSchemeError` the webpack dev server raised on `arpScanner.ts`. The eleven new
             Edge-runtime warnings were fixed by splitting the boot graph into `instrumentation.node.ts` and
             importing it conditionally.
             Two follow-ons from the dependency audit. First, the three production vulnerabilities that the
             upgrade surfaced (seroval via solid-js, and source-map-js) were cleared with `overrides`
             entries, which takes `npm audit --omit=dev` to 0; the dev-only Jest 29 / Tailwind 3 toolchain
             still carries 41 and clearing those means Jest 30 plus Tailwind 4, a migration of its own.
             Second, the runtime image's `COPY instrumentation.ts` is not load-bearing after all: with both
             source files removed from disk, `next start` still installs the guard and starts the
             scheduler, because the hook and its dynamic import are bundled into `.next/server`. An
             `instrumentation.node.ts` copy was added, measured against that, and reverted rather than
             left in on a plausible-sounding but false premise.
             Verified: type-check clean, `next build` warning-free in 24.8s,
             234/234 Jest, dev server boot with the proxy redirecting and a live scheduler, and 19/19
             Playwright against a production `next start` on a freshly seeded database.
2026-10-20 - Role gating had no end-to-end coverage, because the seed created a single ADMIN and every
             spec signed in as it: the C1 defect (rename trigger and three settings buttons visible to a
             VIEWER) could have regressed unnoticed. The seed now writes ADMIN, MEMBER and VIEWER,
             `signInAs()` accepts credentials, and `role-gating.spec.ts` pins the matrix plus the API's
             own 403s. MEMBER is the account that makes the test mean something - it separates "acts on
             its own resources" from "changes global config", so a missing `&&` cannot pass.
             Verified: type-check clean, 24/24 E2E (was 20), 33/280 Jest. `05c3fc9`, `bfb3d71`.
2026-10-20 - An endpoint matrix said the app was complete; tracing values from writer to reader
             found five requirements that were not. `insertBandwidthMetric` had no production caller
             (F-20..F-24 rendered zero), `evaluateBandwidthThreshold` was defined and never called
             (F-31 could never fire), the notification toggles and the retention field were stored and
             never read, there was no `node:dns` use anywhere (F-03), and `theme` had no consumer
             (F-53). This is the failure mode an endpoint inventory cannot see: the route exists, the
             page renders, every test passes, and nothing produces the data. Fixed by adding the
             missing halves - `bandwidthService` as the producer, `runtimeSettings` /
             `notificationPreferences` as resolvers consumed per tick rather than read once at boot,
             `reverseDns` for hostnames the router did not supply, `ThemeSync` for the palette.
             `bandwidthService` differences cumulative counters over actual elapsed time, floored at
             2s so a sub-second scan cannot manufacture a four-figure phantom spike, writes nothing on
             first sight, and treats a negative delta as a counter reset rather than a negative rate.
             Verified: type-check 0, 36/312 Jest (was 33/280), build clean, 28/28 E2E (was 24).
             `dd9c5de`, `34319cb`, `31f8e46`. Dependabot: 0 open.
             The theme E2E outgrew its own unit test twice over. It was written to assert the rendered
             document rather than the stored value, and that single change caught two bugs a passing
             settings test had no way to see: the layout hook and the settings page shared the
             `['settings']` query key with *different* `queryFn` shapes, so whichever mounted first
             decided the cached shape for the other and saving a theme silently applied nothing; and
             the raw pre-paint `<script>` made the hydrated DOM differ from the server HTML (React
             #418). Both were found by a browser, not by reading the code.
```
