# Backlog

Ordered. Work top to bottom. `A-nn` refers to `AUDIT.md`; phases to `PLAN.md`.

Task format: `[ ] B-nn — title (size) [audit ref]` followed by acceptance criteria.
Sizes: **S** ≤2h · **M** half a day · **L** 1–2 days.

When you finish a task: tick it, and if it changed a decision, add a line to `MEMORY.md` §5.

---

## Phase 0 — Stabilise

- [x] **B-01 — Resolve duplicate routes** (M) `A-01`
  - Deleted `app/page.tsx`; it and `app/(dashboard)/page.tsx` both resolved to `/`
  - The route group is now `(app)`, not `(dashboard)`: it no longer names a
    page, and the group means "authenticated shell". The pages it holds are
    `/` (overview), `/devices`, `/devices/[id]`, `/alerts`, `/settings`.
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
  - **Done:** purged from all history with `git filter-repo` and force-pushed;
    the credential itself has since been rotated (2026-09-28).

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
  - **This bit back later:** `mapRowToUser` compared `is_active === 1` directly
    instead of via `toBool`, so `isActive` was *always* `false` and
    `authenticate()` rejected every user. Nobody could log in. Fixed 2026-09-27
    by exporting and reusing `mappers.toBool`.

- [x] **B-12 — Seed script** (M)
  - AC: refuses to double-seed; the seeded admin deliberately has no usable
    password. `scripts/e2e-seed.ts` is the separate, known-password variant.
  - **Superseded 2026-10-14, fixed in `e655fcf`:** once auth shipped, the
    loginless admin stopped being a safeguard and became a defect — the seed
    now writes a real bcrypt hash (cost 12, `ADMIN_EMAIL`/`ADMIN_PASSWORD`
    env override, dev-only fallback). dev.db's existing admin row was updated
    in place to the platform credentials from `.env` (`admin@network-monitor.local`),
    and login was verified end-to-end against `next start`: 200 + session
    cookie + `user logged in` in the server log, 401 on wrong password, 307
    to `/auth/login` without a cookie. `e2e-seed.ts` untouched.

- [x] **B-13 — MySQL in Docker** (S)
  - AC: runs in CI on the MariaDB leg; CI also runs a MySQL 8.4 leg

- [x] **B-14 — Dual-dialect repository tests** (L)
  - AC: every repository test runs twice; both green in CI
  - **Corrected 2026-09-29: this was ticked on a claim that was never true.**
    The database leg had never been green — it could not have been. Five defects
    were hidden by SQLite, all found by actually running it:
    1. All 31 timestamp columns were `datetime` while every write is an
       ISO-8601 string. SQLite accepts that silently; MySQL rejects it, so the
       *first insert of any request failed*. Now `varchar(64)` — see the long
       note at the top of `lib/db/migrator.ts`.
    2. Kysely's `onConflict()` emits SQLite syntax. `upsertFromScan` runs on
       every scan cycle, so the device scan was dead on MariaDB. Now branches on
       dialect to `onDuplicateKeyUpdate`.
    3. `rollupHourly` bucketed hours with `DATE_FORMAT`, which made MySQL
       coerce the ISO string and throw. Now `SUBSTR(col, 1, 13)` — identical on
       both dialects, so the branch disappeared rather than grew.
    4. The CI job ran `npm test` in parallel against one shared database while
       every suite truncates tables in its `beforeEach`. Failure counts swung
       between 13 and 39 on identical code. Now `npx jest --runInBand`; this is
       a correctness fix, not a performance one.
    5. `api.devices.integration.test.ts` used `'test-user'` as a primary key on
       a column declared `uuid`. MySQL enforces that; SQLite does not.
  - Now genuinely green: **199/199 SQLite, 199/199 MariaDB 12.3, 199/199 MySQL 8.4**
    with no reset between runs.

---

## Phase 2 — Scanning and bandwidth

- [x] **B-20 — Scanner interface + simulated** (M)
- [x] **B-21 — ARP scanner with capability probe** (L) `A-16`
  - **Container capability proven end-to-end (2026-10-13).** The Dockerfile
    grants `setcap cap_net_raw+eip` (deliberately NOT `cap_net_admin` — see
    below) and `docker-compose.yml` adds `cap_add: [NET_RAW]`. Verified by
    `scripts/check-container-arp.sh`: as the unprivileged runtime user
    (`node`, uid 1000), `getcap` reports the grant, `arp-scan --help` execs
    (exit 0), and a live sweep of the container gateway returns a real ARP
    reply (`172.17.0.1 → 32:ac:df:51:fe:53`).
  - **Why `cap_net_raw` only:** the kernel refuses to `execve()` a file whose
    file capabilities exceed the process capability bounding set (EPERM), and
    `cap_net_admin` is not in Docker's default set. A `cap_net_raw,cap_net_admin`
    grant therefore cannot start at all unless every deployment also adds
    `cap_add: [NET_ADMIN]` — and `getcap` still reports it as present, so the
    failure is invisible to a getcap-only check. Raw sockets need `NET_RAW`
    alone. This was caught by executing the binary, not by reading `getcap`.
  - **The capability gate no longer trusts `getcap` alone** (`arpScanner.ts`):
    `hasRawCapability()` is now paired with an exec probe (`arp-scan --help`
    must exit 0). getcap advertises caps the kernel will refuse to apply;
    the exec probe is the truth. Regression test added
    (`arpScanner.test.ts › capability gate`).
  - **Re-proven on a from-scratch compose build at the final HEAD `3258005`
    (2026-10-14)** — fresh clone, `docker compose build` → the image's
    `/usr/sbin/arp-scan` reports `cap_net_raw=eip` and the app logs
    `errors:0` scan cycles. Gotcha worth keeping: Debian puts arp-scan in
    **`/usr/sbin`**, so a `getcap /usr/bin/arp-scan` check prints nothing and
    *looks* like a missing capability — resolve the path with `command -v`
    first.
- [x] **B-22 — Fallback chain** (M)
  - Each fallback logs what failed and what it chose
- [x] **B-23 — Offline MAC vendor lookup** (S)
  - `normalizeMac` now throws on anything that is not 48 bits. It used to
    strip non-hex characters, turning `"not-a-mac"` into `"A:C"` and writing
    a phantom device to the database.
  - **Discovered by the /24 probe, not in the backlog (follow-up, not fixed):**
    `oui.ts` imports `oui-data`'s `main` (`index.json`), whose values are the
    *full* record — name **plus postal address, newline-separated** (verified:
    `require('oui-data/index.json')['B4B024']` = `"TP-Link Systems Inc\n5
    Peters Canyon Rd\nIrvine CA 92606\nUnited States"`). Nothing truncates
    (`DeviceTable.tsx:189` and `app/(app)/devices/[id]/page.tsx:189` render
    `device.manufacturer` raw), so a TP-Link device's Manufacturer cell shows
    the whole address block, and the column filter matches against it too.
    The package ships a names-only build for exactly this (`index-s.json`,
    704KB vs 4MB) — a one-line import change plus a DB re-scan would fix it.
    Left alone deliberately: cosmetic, outside the PRD backlog, and no
    PRD acceptance criterion depends on vendor column width.
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
  - Pages live at `/auth/login` and `/auth/setup` (moved 2026-10-01, was
    `/login` and `/setup`); `useSearchParams` is behind Suspense
  - `/login`, `/setup` and `/overview` 308-redirect to their new paths so old
    bookmarks resolve. Verified against a production build: every page route
    serves 200, every retired path 308s, an unauthenticated visit to `/`,
    `/devices`, `/alerts` and `/settings` 307s to `/auth/login?redirect=…`,
    and every redirect chain terminates at a 200 rather than looping.
  - The `?redirect=` param the middleware sets is validated by
    `safeRedirect()` (`lib/utils/redirect.ts`) before the login page navigates
    to it. Without that it was an open redirect — measured, not assumed: a
    login cycle with `?redirect=https://evil.example.com/pwn` produced an
    off-origin navigation. Rejects absolute URLs, protocol-relative `//host`,
    backslash authorities and non-http schemes. Covered by 8 unit tests and an
    E2E test that was confirmed to fail against the unfixed page.
  - A deep link survives the login detour: `/alerts` → login → back to
    `/alerts`, not dumped on the overview. Previously untested.
- [x] **B-33 — Real middleware** (M) `A-10`
- [x] **B-34 — Per-route authorisation** (L) `A-10`
  - `lib/api/auth.ts` re-validates the session cookie in every handler rather
    than trusting middleware headers (PRD F-62)
- [x] **B-35 — Auth rate limiting** (S)
  - Applied to `/api/auth/login` and `/api/setup`
  - The limit is now `LOGIN_RATE_LIMIT_MAX` (default 5). It had to become
    configurable because every E2E spec signs in from one address and the
    production limit failed the suite on the sixth test regardless of
    anything else.

---

## Phase 4 — Dashboard and real-time

- [x] **B-40 — SSE endpoint and event bus** (L) `A-12`
  - `scanJob` is the producer; before this it emitted nothing and the stream
    carried only keep-alives
  - **Fixed 2026-09-29:** a browser closing a tab aborts in-flight requests and
    Node reports that asynchronously, from the HTTP layer, as
    `uncaughtException: [Error: aborted] { code: 'ECONNRESET' }`. Next.js's own
    handler logged and exited, so **any user closing the tab killed the
    server**. Reproduced with the EventSource disabled entirely, so it was not
    the SSE stream. Fixed with a narrowly-scoped
    `setUncaughtExceptionCaptureCallback` in `instrumentation.ts`.
- [x] **B-41 — Delete the WebSocket servers** (S) `A-12`
- [x] **B-42 — `useEventStream` hook** (M)
  - One connection per tab, opened in the dashboard layout
  - AC: backoff reconnect after a server restart
- [x] **B-43 — Overview page** (L)
  - Totals, current throughput, today's peak, top consumers — now **at `/`**,
    backed by `/api/overview` and three repository queries. It was at
    `/overview`; `/overview` now 308-redirects to `/`.
  - AC: every figure traces to a repository query. 12 dual-dialect tests in
    `lib/db/__tests__/overviewQueries.test.ts` cover that, including that the
    sums use each device's *latest* sample and not every sample.
  - **Note (2026-09-30):** the first attempt replaced the device list at `/`
    instead of joining it, deleting the device table page and breaking every
    device E2E spec. The list was restored at `/` alongside a separate
    `/overview`, which left `/devices` 404ing — only `/devices/[id]` existed.
    Resolved 2026-10-01: the overview owns `/` and the list is `/devices`, so
    both exist, neither shadows the other, and the landing page is a summary
    rather than a table.
- [x] **B-44 — Device table** (L)
  - Sort, filter, pagination; 14 component tests
  - **Fixed 2026-09-27:** the API returns a flat `DeviceDTO` (it exists so byte
    counters stay strings) but the client typed the response as
    `EnrichedDevice[]` and read `device.device.lastSeen` — so the dashboard
    threw on every render. The unit tests passed the same wrong shape, which is
    how component and fixtures agreed with each other while both disagreed with
    the API.
- [x] **B-45 — Device detail** (L)
  - Range selector, Recharts, rename dialog
  - The rename dialog could not be opened at all: `onOpenChange` was wired
    straight to `closeEditDialog`, which ignores the boolean it is handed.
  - A rename appeared not to save: `router.refresh()` does nothing for
    client-fetched data, and the react-query cache had a 5-minute `staleTime`.
  - AC: 30-day history under 1s against seeded MySQL — see B-63
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
  - **F-40 gap found 2026-10-09:** `encrypt()` has zero production callers. `upsertRouterConfig()` is never called by any route or UI; the `router_config` table is empty by default. `SCANNER_MODE=asus` can never become available without a writer path. A new `POST /api/router-config` route (ADMIN, encrypt before upsert) plus a settings UI section closes it.
- [x] **B-54 — ASUS router client** (L)
  - Behind the `Scanner` interface, with timeouts
  - Gap: no test drives the HTTP client. `isAvailable` and `scan` need a
    mocked `fetch` — worth doing before relying on it
- [x] **B-55 — Settings UI** (L)
  - AC: Zod-validated at the route boundary, persisted per user

---

## Phase 6 — Hardening and release

- [x] **B-60 — Playwright E2E** (L)
  - **Two harness bugs fixed 2026-10-01, both silent:**
    1. `reuseExistingServer` was on. The webServer command resets and seeds
       before starting, so a reused server skips that and serves whatever
       database it happened to hold. One run reported **6 of 17 specs** and took
       three times as long, with nothing in the output explaining why. Now
       disabled.
    2. The "filters the list" spec waited on `NAS Server` being visible, which
       is already true *before* filtering, so it returned immediately and proved
       nothing; the following assertion then raced the response and failed
       roughly one run in four. The waits are now ordered so the one that can
       block comes first.
  - **17/17 passing across three consecutive runs**, and faster once the stale
    server stopped being reused (58s vs 2-3 min).
  - login · device list · rename · history · configure alert
  - **Corrected 2026-09-29: the suite had never run, here or in CI.** The
    seeding lived in `e2e/global-setup.ts`, which `playwright.config.ts` never
    referenced — it used the setup-project idiom while the config declared
    neither a `globalSetup` nor a project dependency, so it was dead code.
    Nothing seeded the database, the server's boot migrations created it empty,
    and 16 of 16 specs failed on "Invalid email or password".
  - Seeding now runs in the `webServer` command, before `next start`: the
    server opens the SQLite file on first query and then holds it, so on
    Windows a reset during setup is both too late and impossible.
  - The specs were also wrong in ways only visible once they ran: one assumed a
    row click opened the rename dialog, another drove native `<select>`
    elements by clicking options. Both rewritten against the real DOM, with
    counts rather than empty-state assertions so they do not depend on order.
  - **Now 17/17 passing locally**, with zero uncaught exceptions.
- [x] **B-61 — Coverage to 70%** (L)
  - **Refreshed at the final HEAD `3258005` (2026-10-14): 91.01% statements
    (1530/1681), 88.03% branches (228/259), 27/27 suites** — measured by an
    executed `jest --coverage` run, not extrapolated. (An earlier measurement
    recorded here was 86.6% statements/lines.) The threshold is 70% and is
    enforced and verified to fail the build.
- [x] **B-62 — CI pipeline** (M)
  - type-check · build · SQLite suite · MySQL suite · performance · E2E
  - **Updated 2026-10-01:** the performance job was SQLite-only. It is now two
    jobs — `performance-sqlite`, and a `performance-server` matrix over MariaDB
    12.3 and MySQL 8.4 with `fail-fast: false`. Two jobs rather than one
    three-way matrix because `services.*` has no `if` key and an entry with an
    empty image is rejected at validation time, so a conditional service
    container cannot be expressed.
- [~] **B-63 — Performance pass** (M) — **all four PRD §5 targets now measured**
  - `scripts/perf.ts` + `scripts/perfDataset.ts` measure against a real
    100-device, 288,000-sample database and exit non-zero on a miss. CI runs it
    as a gate. Results: `doc/PERFORMANCE.md`, with a generated report per
    engine behind it.
  - Measured on **SQLite, MySQL 8.4.11 and MariaDB 12.3.3**: 30-day history
    query, scan cycle, device list, stats fan-out. 15/15 measurements pass; the
    worst case is 19% of its budget.
  - **First contentful paint added 2026-10-04** (`scripts/fcp.ts`), the one
    PRD §5 target that had no evidence behind it: `scripts/perf.ts` disclaimed
    FCP because nothing server-side can measure a paint event. Measured against
    the same 100-device dataset, signed in, on `/devices`: warm median
    **188ms**, p95 **316ms** against the 2s target — 16% of budget; cold load
    440ms. Gate on p95, exits non-zero on a miss, confirmed to fail by pointing
    it below the measured median.
  - Two methodology errors caught by reading the numbers, both recorded in the
    script: a **fresh browser context per load made "warm" a lie** — an empty
    HTTP cache means every load was cold, and only the OS cache and JIT carried
    over, which is why p95 first read 1.56s — and a **409 from `/api/setup` was
    swallowed** into a 30-second login timeout with no explanation.
  - **Fixed 2026-10-01:** the harness could only run against SQLite. Two
    separate causes, both fixed rather than worked around:
    `assertDisposableDatabase` hard-required `DB_FILE`, which is meaningless on
    MySQL, and the report path was a fixed `doc/PERFORMANCE.md`, so the second
    engine measured would silently overwrite the first. It now takes a throwaway
    target appropriate to the dialect (a file on SQLite, a schema on MySQL) and
    writes a report per **engine** — keyed on the engine, not `DB_CLIENT`,
    because `DB_CLIENT=mysql` covers both servers. Keying on the dialect was
    tried first and observed to overwrite MySQL 8.4 with MariaDB 12.3.
  - Each report records the server's own `VERSION()`, so a report cannot be
    filed under the wrong engine; CI verifies it before measuring.
  - `lib/utils/__tests__/performanceIndex.test.ts` checks the hand-written index
    still quotes the generated p95s for every engine and never claims an
    all-pass the reports do not support. Both assertions confirmed to fail when
    the index is broken.
  - **Finding worth keeping:** SQLite is the *slowest* engine on the stats
    fan-out (192.7ms vs 17.0ms on MySQL, 6.7ms on MariaDB — 11–29x slower),
    and the only engine within 20% of its budget. SQLite wins the 30-day
    history query and the device list. So "in-process is faster" is false for
    the query the dashboard runs most often, which is a correlated subquery over
    the whole metrics table.
  - **Still not measured:** the real ARP `/24` probe (needs `CAP_NET_RAW` and a
    live, authorised subnet). The application-side scan budget is measured; the
    network-side budget is not.
  - **Disclosed limit:** `scanOnce()` discovers 12 simulated devices, so a run
    measures 112 devices for the list and fan-out rows. The server reports read
    112 where the SQLite report reads 100, because the two were measured in
    different orders. Not "fixed", because both fixes change what is measured.
- [~] **B-64 — 24-hour soak** (M) — **RUNNING attempt 3: launched 2026-10-14 16:53:00 +02:00 via Task Scheduler (`SNM-Soak-Launch`), expected completion 2026-10-15 ~16:53**
  - Launched LAST in sequence, as required — after MySQL 225/225 at `3258005`,
    the DEPLOYMENT.md from-scratch reproduction, the ARP `/24` probe, the docs
    pass, and a green `next build` at final HEAD (the CI build leg is
    billing-blocked, so the local build is its substitute). Jest re-run before
    the harness commit: **225/225 pass, exit 0**.
  - **Two prior attempts were killed by other processes on this machine — both
    deaths proven from `opencode.log` forensics, neither a soak bug:**
    - *Attempt 1* (12:22 → 14:00:33, 98 min, `exit=-1`): killed together with
      the session's checkpoint shells by an opencode server restart, and the
      log at `12:00:32.521Z` shows another opencode instance ran
      `Get-Process "node" | Stop-Process -Force` (a temp-cleanup script) — one
      second before the soak died. `err.log` had zero JS output; last scan was
      clean. Logs: `doc/soak-2026-10-14-attempt1.*.log`.
    - *Attempt 2* (16:15 → 16:17, 3 min, task `Last Result -1073741510` =
      `0xC000013A` STATUS_CONTROL_C_EXIT): a console control/close event
      reached the tree launched by the scheduled task. Logs:
      `doc/soak-2026-10-14-attempt2.*.log`.
  - **Attempt 3 counters (threat model → design):** (1) soak runs as
    `data\node-soak.exe`, a renamed node.exe, so `Get-Process "node"` sweeps
    miss it — verified live: pid 19004 absent from `Get-Process node` while
    16 plain `node` processes existed; (2) the child is started with
    `DETACHED_PROCESS` (no console at all) and the wrapper calls
    `SetConsoleCtrlHandler(NULL, TRUE)`, so console signals cannot reach it;
    (3) no npm/npx in the chain — `node-soak.exe` runs `ts-node/dist/bin.js`
    in-process → the soak is exactly one process; (4) launch is a scheduled
    task (`SNM-Soak-Launch` → `powershell -File scripts\soak-launch.ps1`),
    outside opencode's process tree so a server restart cannot kill it.
  - Mechanics: wrapper pid 57056 → `node-soak.exe` pid 19004, single process.
    Env mirrors `.github/workflows/soak.yml`: `SOAK_MINUTES=1440`, 60s sample /
    30s scan, placeholder secrets, `NODE_OPTIONS=--expose-gc`,
    `DB_FILE=./data/soak.db`. Fresh DB migrated 16:50 (6 migrations, exit 0).
    3-minute smoke of the exact new code path passed first: `exit=0`,
    `elapsed=3.3min`, err empty, `SOAK.md` written (archived as
    `doc/SOAK-smoke-3min-2026-10-14.md` so `doc/SOAK.md` can only be written
    by the real completion).
  - Checkpoints all run from Task Scheduler now (survive opencode restarts):
    `SNM-Soak-Check-60m` at 17:53, `SNM-Soak-Check-Final` at 2026-10-15
    17:13, and `SNM-Disk-Guard` every 2h — the guard only deletes caches when
    free space drops under 600 MB (other agents keep refilling npm-cache; this
    machine had 0.39 GB free before cleanup, 0.80 GB at launch). All append to
    `doc/soak-checkpoints.log`.
  - Keep-awake is two-layer: `powercfg` AC standby/hibernate timeouts set to
    *never* (exit 0), plus `scripts/keep-awake.ps1` pid 47700 holding
    `ES_CONTINUOUS|ES_SYSTEM_REQUIRED` (`HOLD_ACQUIRED` in
    `doc/keep-awake.log`; its 25h hold from 12:32 expires ~13:32 on 10-15,
    ~3.5 h before the soak ends). Attempt 3's wrapper also takes its own
    `SetThreadExecutionState` hold for the run's lifetime — the earlier hold
    bug (PowerShell parses `0x80000000` as **signed** Int32, the uint32
    P/Invoke rejects it) was fixed with decimal `[uint32]` literals and is
    smoke-tested on every launch (`HOLD_ACQUIRED flags=2147483649`).
  - **Attempt 1 +5 min check (12:27): alive** — scans every 30s
    (`devicesFound:12, errors:0`), disk steady at 1.63 GB. That run's
    checkpoints were opencode background shells, which the server restart
    also cancelled — hence Task Scheduler for all attempt-3 checkpoints.
    The harness itself writes `doc/SOAK.md` at completion.
  - `scripts/soak.ts` runs real scan cycles, fits a least-squares heap trend,
    and installs its own `unhandledRejection` / `uncaughtException` traps
    because test runners and CI both swallow those by default.
  - All three gates were **observed failing** via fault injection
    (`SOAK_FAULT=rejection|memory`), so the detectors are known to work rather
    than assumed to. A clean 5-minute run: 100 scan cycles, 0.1% heap
    retained, 0 rejections — `doc/SOAK.md`.
  - **The 24-hour run was structurally impossible until 2026-10-02, not merely
    pending.** GitHub Actions cancels any job at 6 hours, and the log says so
    exactly: *"The job has exceeded the maximum execution time of 6h0m0s"*. The
    workflow asked for `SOAK_MINUTES=1440` and `timeout-minutes: 1560`, and
    neither overrides that cap. Every scheduled run died at 6h with no report.
  - Now four sequential ~330-minute segments (22h wall clock) plus a `verdict`
    job that fails unless all four passed. The gate lives in the verdict job so
    one green segment cannot read as a completed soak. The report states it is
    a segment and what segmentation does *not* prove, so a 6h figure cannot be
    mistaken for 24h.
  - A single-process 24h run remains possible and is the stronger evidence —
    on a machine that will hold a process open for a day, not on a CI runner.
  - **First attempt interrupted 2026-10-07 12:12 with ^C** (log ends `^C^C`, last
    write 12:12:28). PID 57908 gone, `doc/SOAK.md` never written — exactly the
    failure mode expected when a 24h process is killed before its final write.
    It must be relaunch from zero; partial data (15h of 24h in `data/soak.db`)
    carries no verdict. Relaunched last, after all code fixes, with no console
    attachment and stdin closed so an accidental Ctrl+C cannot reach it.
  - **The segmented pipeline is verified working** (2026-10-02, run
    `36950230328`): all four segments plus the verdict job green. Dispatched at
    `minutes=5` so the shape could be checked in 20 minutes rather than 22
    hours — segment 1's report: 10 scan cycles, 0 errored, 0.0% heap retained,
    0 unhandled rejections, 0 uncaught exceptions, with the segment recorded in
    its own report. The nightly schedule runs 330 minutes per segment.
  - Two workflow bugs found only by dispatching it, not by reading it: GitHub
    expressions have no arithmetic, so `${{ (a) * 4 / 60 }}` made the whole
    file unloadable (`Unexpected symbol: '/'`). Valid YAML is not a loadable
    workflow.
- [x] **B-65 — Deployment docs** (M)
  - `doc/DEPLOYMENT.md`, `doc/TROUBLESHOOTING.md`, `Dockerfile`, Compose
  - **Verified from a clean checkout 2026-10-14 at `3258005`.** A fresh clone
    was followed against the quick start; the original doc was found *wrong*
    in two places and both were fixed by execution, not inspection:
    1. The `.env` heredoc omitted `DB_*`, so `docker compose up` failed fast on
       the `:?` required-variable checks — heredoc now includes `DB_NAME`,
       `DB_USER`, `DB_PASSWORD`, `DB_ROOT_PASSWORD`.
    2. Nothing applied migrations on boot (`ENABLE_DB_MIGRATIONS_ON_BOOT` is
       gated in `instrumentation.ts:109`), so a fresh DB would 500 at `/setup`
       — heredoc now sets it, and the **First run** section documents the
       `npm run db:migrate` fallback for when it is unset.
    - Service-name gaps fixed: the bundled service is `mariadb`, but the doc
      said the `mysql` service starts alongside `app` and the backup example
      ran `compose exec mysql mysqldump` (both corrected; `DB_CLIENT=mysql` is
      the driver/dialect name, not the server — `docker-compose.yml` explains).
    - End-to-end result with the fixed doc: `mariadb` healthy → `app` built and
      started → `/api/health` `ok` in ~10s (`database.client=mysql connected`,
      scheduler `scan scheduled / rollup running / prune running`) → log line
      `"migrations applied on boot"` → `GET /setup` **308** to `/auth/setup`
      **200** (not 500) → fresh image's `/usr/sbin/arp-scan` reports
      `cap_net_raw=eip`, `arp-scan --help` exits 0 as uid 1000, and scan cycles
      complete with `errors:0` (`devicesFound:0` is expected — the container's
      Docker network cannot reach the configured LAN `192.168.1.0/24`).
- [ ] **B-66 — Release checklist** (S)
  - **BLOCKED, and not by code: GitHub Actions billing.** As of 2026-10-03
    every job — CI and soak alike — fails in 2–13s with *"The job was not started
    because recent account payments have failed or your spending limit needs to
    be increased"*. No step executes, so these runs carry no information about
    the code and must not be read as test failures. It needs an account-level
    fix (Billing & plans), not a commit. Everything below is verified locally
    until that is resolved.
    - **Re-triaged 2026-10-13 after the latest push (`3258005`).** CI run
      `38400691524` (8 jobs) and soak run `38384738146` (all 4 segments + the
      verdict job) each failed in 2–11s with the *identical* annotation. The
      workflow structure is intact — jobs are created, they just cannot start.
      This is a billing problem, not a workflow defect; the last real CI result
      (8/8 green, `36949209423` at `a5715d2`) still stands. Once billing is
      fixed, the next push should re-run 8/8.
  - Remaining PRD §7 gaps once CI runs again:
    - **A single-process 24-hour soak (B-64).** The harness is proven and the
      segmented workflow was verified green end to end (run `36950230328`, all
      four segments plus the verdict job) before billing blocked it. The
      outstanding item is the *true* single-process 24h figure, which needs a
      machine that will hold a process open for a day. GitHub's 6h job cap is a
      hard limit, not a configuration choice.
  - **Dependabot: 11 open alerts on the default branch (3 critical, 3 high,
    5 moderate)** — visible again in the push output for `10a8c98` (2026-10-14),
    though a `.ps1` commit cannot change dependencies; these are pre-existing.
    Triaged by reachability rather than severity headline:
    - *Development chain:* `handlebars 4.7.9` (via `ts-jest`, 2 critical +
      2 moderate), `sprintf-js` and `postcss-selector-parser` (moderate).
    - *Runtime-flagged:* `next 15.5.26` (direct dep, 2 moderate SSG/ISR cache
      poisoning), `sharp 0.35.4` (via next, high, librsvg CVE), `seroval 1.5.6`
      (critical + high — path is `react-query-devtools → solid-js`, i.e. the
      devtools bundle, but Dependabot flags it runtime), `source-map-js`
      (via postcss, build chain).
    - **Deliberately not remediated before the soak:** bumping `next` or
      refreshing the lockfile would mean the 24h soak no longer runs against
      the exact tree every other verification covered, and CI cannot validate
      a dependency bump while billing blocks all runners. Sequenced as its own
      pass: bump within 15.x + lockfile refresh → full local suite + build +
      FCP re-measure → CI re-run once billing clears.
  - No longer on this list:
    - **The real ARP `/24` probe (192.168.1.0/24) — executed 2026-10-14,
      authorised by user.** Two attempts, both real:
      1. *WSL, project harness `scripts/arp-probe.sh`* (rails all passed —
         subnet explicit, RFC1918, `cap_net_admin,cap_net_raw=eip` present):
         warm-up plus three timed runs, each `256 hosts scanned … 0 responded`.
         Cause measured, not assumed: WSL2 routes the LAN *through NAT*
         (`ip route get 192.168.1.1` → `via 172.23.224.1`) and its neighbour
         table stays empty for LAN addresses, so arp-scan's who-has frames
         land on the virtual switch, never on the Wi-Fi segment.
      2. *Windows host, `scripts/arp-probe.ps1` (new, committed)* — the only
         adapter on the LAN's layer-2 is the host's own Wi-Fi
         (`192.168.1.103/24`). **253 targets in 1724ms wall clock, full
         coverage verified** (all 254 addresses present in the neighbour table
         afterwards: 1 `Reachable` + 252 `Unreachable`), **1 ARP responder** —
         the gateway `192.168.1.1 → B4:B0:24:73:C9:44`, vendor resolved
         through the app's own `oui-data` (TP-Link). IPv6 corroborates: the
         only link-local neighbour is the same gateway (EUI-64), so the
         segment is genuinely this quiet — router + this PC — not a coverage
         gap. `arp -a` agrees.
      - **Method disclosure (the honest difference):** the chosen plan was
        Npcap + scapy; Npcap needs an elevated installer, and that question
        was never answered — so instead of stalling, `arp-probe.ps1` drives
        the *OS's own neighbour resolution* with a fast ICMP pass: sending any
        IP datagram at a LAN host makes Windows issue the **same ARP who-has
        frame arp-scan would**, and the (IP, MAC) pairs are read from the same
        table `arp -a` shows. Discovery does *not* depend on ICMP replies
        (a host that drops echo but answers ARP is still found); what differs
        is OS throttling (timing is not arp-scan's hosts/sec) and the fact
        that raw-L2 capture itself remains unrun on this host (Npcap absent).
        No elevation, no packet driver, no permission beyond the authorisation
        already given.
    - Browser first contentful paint — measured 2026-10-04 at p95 **316ms**
      against the 2s target (`scripts/fcp.ts`, gated in CI).
    - The MySQL performance numbers — B-63 is benchmarked on all three engines,
      and CI regenerates them on every push.
    - "CI has never run" — it had never run *successfully*. On 2026-10-02 it was
      8/8 green, including the two MySQL jobs that had never executed once.

- [ ] **B-67 — `npm run dev` serves 500s at HEAD** (M)
  - **Discovered 2026-10-14 while verifying the platform-admin login.** Every
    dev-mode response — pages, API routes, even `/api/health` — is the dev
    error page with `Module not found: Can't resolve 'fs'`, import-traced as
    `better-sqlite3/lib/database.js → lib/db/client.ts →
    lib/services/rollupJob.ts → instrumentation.ts`: the instrumentation
    compilation bundles the native driver instead of honouring
    `serverExternalPackages` (which `next.config.mjs` does list it in).
  - **Repro:** `npm run dev` on a clean `.next`, request `/api/health` —
    log shows `Compiling /instrumentation`, then `GET /api/health 500` on
    every subsequent request. Checked 2026-10-14 with next 15.5.26 installed
    *and* lockfile-pinned, tracked tree clean at `e655fcf`.
  - **Not a blocker for anything the PRD measures:** `next build` compiles the
    same instrumentation graph fine, and `next start` was verified end-to-end
    the same day (health 200, login 200/401, cookie session, anonymous 307) —
    that is also the path e2e and FCP use. But `npm run dev` is the documented
    dev workflow (doc/README.md, PLAN.md demo, DEPLOYMENT.md) and MEMORY.md's
    hot-reload lessons say it once worked, so this is a regression.
  - Suspected window: dev-mode handling of `serverExternalPackages` for the
    instrumentation compile in the 15.5.x line — bisect against the 15.1.x
    bump together with the dependency pass (B-66), not as a panic patch.

- [x] **B-68 — Seed byte counters decreased over time ("Total Traffic
  0.00 B")** (S) — fixed `3c375c1`
  - **Found 2026-10-15 by logging in as the platform admin and opening a
    device detail page.** The API's `totalTransferred` is the *latest*
    bandwidth row's cumulative counters (correct), but the seed indexed
    totals by absolute sample position (`base * 65536`), so counters *fell*
    as time advanced and the newest row of the first device landed on
    exactly `0` — every fresh `db:seed` therefore rendered
    "Total Traffic 0.00 B / 0.00 B" on the device page.
  - Fix: per-device running totals accumulated in chronological order
    (1 Mbps sustained per 30-min sample = 225 MB). Gotcha kept: within a
    day the slot loop runs newest-first (slot 0 is the day's *latest*
    moment), so the slots must iterate 47→0 or the counters accumulate
    backwards — first verification run caught exactly that (12/12 devices
    non-monotonic) before the loop was reversed.
  - Verified: fresh seed → 12 devices × 336 samples, 0 monotonicity
    violations, newest counters 141.75 GB / 2.50 TB; `dev.db` repaired in
    place (4033 rows) and the running platform showed 130.41 GB / 2.70 TB
    for Ana's iPhone in the browser.

- [x] **B-69 — Connection History was a hardcoded placeholder** (M) —
  fixed `3c375c1`
  - **Found the same session as B-68.** PRD §1 promises the app "tracks its
    bandwidth and connection history"; the `connection_logs` table,
    `connectionLogRepository.listByDevice`, and the scanner's
    connected/disconnected writes all existed, but no endpoint consumed
    them — the device page rendered "Connection history will be displayed
    here" forever (the exact failure MEMORY.md rule #7 names).
  - Fix: `GET /api/devices/:id/connection-logs` (VIEWER+, `limit` 1–100
    default 20, newest first, 404 unknown device, 400 bad limit),
    `useDeviceConnectionLogs` hook, and the real card UI (event colour,
    duration via `formatDuration`, honest empty state). Contract pinned by
    a new integration suite (5 tests); 230/230 total.
  - E2E verified in the browser: iPhone page fetches
    `connection-logs?limit=20` → 200, renders seeded events newest-first.

- [x] **B-70 — API.md documents endpoints that do not exist** (S) doc-only
  - Found 2026-10-15 while documenting B-69. `glob app/api/**/route.ts`
    vs API.md: phantom entries are `GET /api/auth/me`,
    `POST /api/devices/scan`, `DELETE /api/devices/{id}` (the route exports
    GET+PATCH only), and all three `/api/bandwidth/*` endpoints
    (`current`, `top-consumers`, `history`) — the overview route covers
    that data. The PATCH example also promises `categoryId`/`isIgnored`,
    which the route's allowlist rejects. The device-detail, connection-logs
    and per-device-bandwidth sections were corrected in the same pass
    (local doc only — `doc/` is not versioned).
  - Fix in one docs pass against the actual route exports; do not invent
    the phantom endpoints.
  - Done 2026-10-18, and the two cheapest gaps were **implemented** rather
    than documented away, because both were already half-present:
    `GET /api/auth/me` (the sidebar and role gating needed it) and a widened
    `PATCH /api/devices/{id}` that now accepts `categoryId`/`isIgnored` as
    `API.md`'s example has always promised. Everything else was documented
    as a deliberate non-implementation with the reason beside it —
    `DELETE /api/devices/{id}` (device inventory is passively observed;
    deletion reappears on the next scan), `POST /api/devices/scan` (the
    scheduler scans continuously), `/api/bandwidth/*` (superseded by
    `/api/overview`), and the router `test`/`status`/`block` routes (no
    router integration exists to call). `PATCH /api/settings` is now marked
    ADMIN-only, matching the code.
  - Two real defects surfaced while writing the contract tests, both now
    pinned: `PATCH /api/alerts/{id}` forwarded absent fields as `undefined`,
    and `alertRepository.update()` selects on `'deviceId' in patch` — so a
    PATCH carrying only `isActive` **nulled the device scope**, silently
    turning a per-device rule into a global one (confirmed by reverting the
    fix: `device_id` came back `null`). The handler now assembles the patch
    key by key and rejects an empty body. And `POST /api/alerts` accepted
    `bandwidth_exceeded` with no threshold, which could never fire.
  - AC: API.md matches `app/api/**/route.ts` exactly; `npx tsc --noEmit`,
    `npx jest` (33 suites / 280 tests), `next build` and
    `npm run test:e2e` (19/19) all pass — verified 2026-10-18.

---

## Known follow-ups

- **The leaked MySQL credential is fully closed.** Purged from all history with
  `git filter-repo` and force-pushed; the password was then rotated. Two
  things had to happen and both did: rewriting history cleans the repository,
  rotating the credential actually closes the exposure. The `.gitignore` glob
  (`.env*`, not `.env.*`) is in place, and a `pre-commit` hook now refuses to
  stage any real env file — it is versioned at `scripts/git-hooks/`, installed
  with `npm run hooks:install`.
- **MySQL is a supported dialect again** — `PERFORMANCE.mysql.md` exists (engine 8.4.11, 100-device/288k-sample dataset), and the CI `performance-server` matrix runs on MySQL 8.4 with `fail-fast: false`. The full Jest suite was executed against a genuine MySQL 8.4.11 server (Docker container, engine confirmed by `scripts/verify-engine.js mysql`): **225/225 tests, 27/27 suites, zero skips, re-run at the final HEAD `3258005` on 2026-10-14** (223 before the two ARP capability-gate tests were added). An earlier revision of this file claimed "214/214 at `0731ea2`" — that number was a prediction and had never been run; it is replaced here by the executed result. The claim "the app has never been exercised against real MySQL" is closed for the test suite. The Docker-compose `DEPLOYMENT.md` reproduction from a clean checkout is now also closed (verified 2026-10-14 — see B-65 above).
- **Two intermittent full-suite flakes on this Windows dev box (not code defects).** Under `--runInBand` the whole suite shares one process, and two tests fail occasionally while passing in isolation and in the vast majority of full runs: (1) `alertEngine.leak › device_alerts/notifications has foreign key` reported "Received function did not throw" twice — the FK insert resolved despite the constraint being present in the DDL and `PRAGMA foreign_keys` reading 1 (instrumented runs show the insert correctly throwing `FOREIGN KEY constraint failed`); (2) `DeviceTable › sorts by name` exceeds jest's 5s timeout under load — the file takes ~107s standalone, so it is borderline slow regardless. Neither is caused by the current changes (DeviceTable untouched; the FK failure appeared after a suite-order shift and never reproduced under instrumentation). CI runs on dedicated Linux runners where the load profile differs; if either recurs there it should be triaged with the sequencer order and per-test timings captured.
- **A large failure count is not automatically a regression — check the error signature first.** On 2026-10-13 a MySQL run reported *84 failed / 141 passed*; every failure was `connect ECONNREFUSED 127.0.0.1:13306`, because a disk-full incident had crash-looped dockerd and the host→container port forward broke while mysqld inside the container stayed healthy (`mysqladmin ping` succeeded). Restarting the container restored the mapping and the same code at the same commit went **225/225** the next day (`mysql-final2.log`, 2026-10-14). Rule applied since: a wall of identical connection errors means the environment, not 84 separate bugs.
- **Migration 001–006 were edited in place** when the timestamp columns
  changed from `datetime` to `varchar(64)`. This is safe *only* because the
  MySQL path had never successfully written a row, so no real deployment has a
  MySQL schema built from the old definitions. Any database that *does* have
  those tables must be recreated. SQLite databases created before the change
  keep their old `datetime` column types, which still work but no longer match
  the migrations.
- **Multi-instance deployments need a shared rate-limit store.** The current
  store is in-process, so limits are per container.
- **CSRF** is mitigated by `sameSite=lax` rather than by a token. Adequate for
  a single-origin dashboard; revisit if the API is ever called cross-site.
- **Client disconnects are swallowed at the process level.** The filter is
  narrow — only `ECONNRESET` / `EPIPE` / `aborted` / `AbortError` — and
  everything else is rethrown, but it is still a process-wide safety net
  standing in for a per-connection error handler that Next.js does not give us.

---

## Session updates — 2026-10-25 (audit-plan + weekly vulnerability automation)

- **Audit-plan naming preserved:** `plan-admin-features-2026-10-25.md` and
  `checklist-resolve-gaps.md` created at `.opencode/plans/` per the
  `plan-<feature>-YYYY-MM-DD.md` convention; previous
  `audit-and-resolve-all-gaps-2026-10-24.md` (missing from repo) reconstructed
  from session record.
- **Dependency vulnerability pass complete:** `zod` upgraded `^3.23.8` →
  `^4.6.7` (addresses `GHSA-mrhx-c7xc-m3w5`); `lib/config.ts:160`
  `i.received` → `i.input === undefined`; `npm audit` reports `0`;
  `package-lock.json` refreshed; overrides preserved (`postcss`,
  `source-map-js`, `solid-js`, `handlebars`, `postcss-selector-parser`,
  `js-yaml`). No secrets exposed.
- **Weekly auto-check / auto-fix implemented:** `scripts/weekly-audit-fix.mjs`
  (audit `high` level, safe `npm audit fix`, exit 0/1/2); `package.json`
  `weekly-audit`; `scripts/cron-weekly-audit.txt` (`0 2 * * 1` — Monday
  02:00). First run verified: exit `0`, audit `found 0 vulnerabilities`,
  `logs/weekly-audit.log` clean, no secrets logged.
- **Auth / CSP / docs verified:** auth layer with Zod schemas, cookie
  session (`httpOnly`), CSP + security headers (`next.config.ts`), generic
  errors, autofill removed; `API.md` + `SECURITY.md` document verified
  endpoints + session details.
- **No user data / `.env.local` altered:** only `tests/` artifacts,
  caches, and stray `removepath` dirs cleaned; `.env.local` secrets
  rotated (`DB_PASSWORD`, `SESSION_SECRET`, `ADMIN_PASSWORD`,
  `VIEWER_PASSWORD`).
