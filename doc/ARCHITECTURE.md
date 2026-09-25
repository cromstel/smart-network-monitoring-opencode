# Architecture

Companion to `PRD.md`. Describes the target design. Where the current tree differs, `AUDIT.md` has the finding and `TODO.md` has the task.

---

## 1. Shape

```
Browser
  │  HTTP (TanStack Query)        SSE (/api/events)
  ▼                                   ▲
┌──────────────────────────────────────────────┐
│ Next.js 15 App Router                        │
│                                              │
│  app/(dashboard)/*   React Server + Client   │
│  app/api/*           route handlers (thin)   │
│  middleware.ts       session + role gate     │
│  instrumentation.ts  starts the scheduler    │
├──────────────────────────────────────────────┤
│  lib/services/       business logic          │
│  lib/db/repositories domain queries          │
│  lib/db/client       ONE connection pool     │
├──────────────────────────────────────────────┤
│  Kysely  ──►  mysql2 (prod) | better-sqlite3 │
└──────────────────────────────────────────────┘
        │
        ├─ node-cron: scan, aggregate, prune
        └─ scanners: simulated | arp | asus
```

## 2. Layering

```
route handler  →  service  →  repository  →  database
component      →  hook     →  route handler
```

Hard rules:
- A route handler never touches a repository directly. It validates input, calls one service, shapes the response.
- A component never imports a service. Server state arrives through a hook backed by TanStack Query.
- A repository never contains business logic — no thresholds, no alert decisions, no formatting.
- Only `lib/db/client.ts` constructs a connection.

Why: the scanner, the cron jobs, and the API all need the same device logic. If it lives in route handlers it gets duplicated, and the two copies drift.

---

## 3. Dependencies

Every dependency needs a justification line here. No line, no dependency.

| Package | Why |
|---|---|
| `next`, `react`, `react-dom` | Framework |
| `kysely` | Typed SQL for two dialects without a codegen binary |
| `mysql2` | MySQL driver; production |
| `better-sqlite3` | SQLite driver; development. Synchronous, which is fine for a dev DB |
| `@tanstack/react-query` | Server-state cache, refetch, invalidation |
| `zod` | One schema validates the API boundary and the form |
| `react-hook-form`, `@hookform/resolvers` | Forms, Zod-bound |
| `recharts` | Time-series charts |
| `framer-motion` | Page and list transitions (PRD §6.3) |
| `@radix-ui/*` | Accessible primitives under the UI components |
| `lucide-react` | Icons |
| `tailwindcss`, `clsx`, `class-variance-authority` | Styling and variants |
| `bcryptjs` | Password hashing |
| `node-cron` | Scheduled scans, aggregation, pruning |
| `oui-data` | Offline MAC vendor lookup — no network call per device |
| `nodemailer` | Password reset (P2) |
| `pino` | Structured logging |

**Removed:** `@prisma/client`, `@prisma/extension-accelerate`, `prisma`, `pg` (PostgreSQL), `crypto` (dead placeholder — use `node:crypto`), `axios` (use `fetch`).

---

## 4. Data layer

### Why a query builder
The dual-dialect requirement is the whole problem. Raw SQL means maintaining two variants of every statement and discovering the divergence in production. A binary-engine ORM is unavailable (`MEMORY.md` §2). Kysely generates dialect-correct SQL from one typed definition and ships as plain JavaScript.

### Client — exactly one pool

```ts
// lib/db/client.ts
import { Kysely, MysqlDialect, SqliteDialect } from 'kysely'
import type { DB } from './schema'

const g = globalThis as unknown as { __db?: Kysely<DB> }

function create(): Kysely<DB> {
  if (process.env.DB_CLIENT === 'mysql') {
    const { createPool } = require('mysql2')
    return new Kysely<DB>({
      dialect: new MysqlDialect({
        pool: createPool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT ?? 3306),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          connectionLimit: 10,
          timezone: 'Z',
          supportBigNumbers: true,
          bigNumberStrings: true,   // BIGINT -> string, never a JS bigint (AUDIT A-05)
        }),
      }),
    })
  }
  const Database = require('better-sqlite3')
  return new Kysely<DB>({
    dialect: new SqliteDialect({ database: new Database(process.env.DB_FILE ?? './data/dev.db') }),
  })
}

export const db = g.__db ?? create()
if (process.env.NODE_ENV !== 'production') g.__db = db
```

The `globalThis` cache is not optional. Without it, Next.js dev hot-reload opens a new pool on every file save until MySQL refuses connections — the exact failure in `AUDIT.md` A-08.

### Dialect differences to respect

| Concern | MySQL | SQLite | Rule |
|---|---|---|---|
| Primary key | `CHAR(36)` | `TEXT` | Generate UUIDv4 in application code. Never rely on auto-increment |
| Timestamps | `DATETIME(3)` | `TEXT` ISO-8601 | Always write UTC ISO strings; convert at the repository edge |
| `updatedAt` | `ON UPDATE CURRENT_TIMESTAMP` | not supported | Set it in application code, both dialects |
| Big integers | `BIGINT` | `INTEGER` | Read as `string`, expose as `string` |
| Booleans | `TINYINT(1)` | `INTEGER` | Normalise to `boolean` in the repository |
| `UPSERT` | `ON DUPLICATE KEY UPDATE` | `ON CONFLICT DO UPDATE` | Kysely's `onConflict` compiles both |
| Case sensitivity | collation-dependent | binary | Store MAC addresses uppercase, normalised at ingest |

### Migrations
Plain `.ts` files under `lib/db/migrations/`, run by Kysely's migrator, named `NNN_description.ts`, each with `up` and `down`. Forward-only in production. Never edit a migration that has run anywhere — add a new one.

### Repositories
One file per aggregate: `deviceRepository.ts`, `bandwidthRepository.ts`, `alertRepository.ts`, `userRepository.ts`, `settingsRepository.ts`. Each exports plain functions taking and returning domain types from `lib/types/`. No framework types cross this boundary.

---

## 5. Scanners

```ts
// lib/services/scanners/types.ts
export interface DiscoveredDevice {
  macAddress: string        // uppercase, colon-separated
  ipAddress: string
  hostname?: string
  signalStrength?: number
}
export interface Scanner {
  readonly name: 'simulated' | 'arp' | 'asus'
  isAvailable(): Promise<boolean>
  scan(subnet: string): Promise<DiscoveredDevice[]>
}
```

Selection at startup, in order: the scanner named by `SCANNER_MODE` → `asus` if a router is configured and reachable → `arp` if `isAvailable()` passes → `simulated`. Each fallback logs a warning naming what failed and what it fell back to (PRD F-07).

`isAvailable()` for the ARP scanner is what prevents `AUDIT.md` A-16: it probes for the binary and for `CAP_NET_RAW` before the first scan, instead of failing on every cycle.

**Simulated data lives here and nowhere else.** A component calling `Math.random()` to fill a chart is a bug, not a placeholder (A-14).

---

## 6. Real-time updates

Server-Sent Events, not WebSockets.

```
app/api/events/route.ts   ReadableStream, text/event-stream, 30s keep-alive comment
lib/services/eventBus.ts  in-process emitter; scanner and alert engine publish
lib/hooks/useEventStream  EventSource subscriber; invalidates TanStack Query keys
```

Events: `device.connected`, `device.disconnected`, `bandwidth.tick`, `alert.raised`.

The client does not render event payloads directly. An event invalidates a query key and TanStack refetches. One code path for data, whether it arrived by poll or by push.

Rationale for SSE over `ws`: one-directional is all the dashboard needs, it survives standard Node hosting and reverse proxies, it reconnects on its own, and it does not require a second server process. See `AUDIT.md` A-12.

---

## 7. Configuration

Root `.env.example`:

```bash
# Database — 'sqlite' (development) or 'mysql' (production)
DB_CLIENT=sqlite
DB_FILE=./data/dev.db

# MySQL — required when DB_CLIENT=mysql
DB_HOST=localhost
DB_PORT=3306
DB_NAME=home_monitor
DB_USER=monitor
DB_PASSWORD=

# Security — generate with: openssl rand -hex 32
SESSION_SECRET=
ENCRYPTION_KEY=          # 32 bytes hex, AES-256-GCM for router credentials

# Network
NETWORK_SUBNET=192.168.1.0/24
SCANNER_MODE=simulated   # simulated | arp | asus
SCAN_INTERVAL_SECONDS=30

# App
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug
```

Validated once at startup by a Zod schema in `lib/config.ts`. A missing or malformed variable fails fast with a message naming it — never a runtime `undefined` three layers deep.

---

## 8. Security

**Router credentials.** AES-256-GCM. Store `iv:authTag:ciphertext` hex-joined in one column. Key from `ENCRYPTION_KEY`. Decrypt only inside the router service, at the moment of use. The password field is excluded from every serialiser — there is no API shape that includes it.

**Sessions.** Opaque random token, hashed in the `sessions` table. Cookie is httpOnly, sameSite=lax, secure in production. Sliding expiry, 7 days.

**Authorisation.** Middleware checks that a session exists. Each route handler re-checks the role it requires. Middleware alone is not authorisation (PRD F-62).

**Input.** Zod at every route boundary. Parse, don't validate — the parsed object is what reaches the service, so an unvalidated field cannot leak through.

**Logging.** `pino` with a redaction list covering `password`, `token`, `secret`, `authorization`, `cookie`.

---

## 9. Performance

- Indexes per `DATABASE.md`; the composite `(device_id, timestamp)` on `bandwidth_metrics` carries every history query.
- Raw metrics are rolled into hourly aggregates nightly. History over 24h reads aggregates, not raw rows — this is what keeps the 30-day query under 1s.
- Retention pruning deletes raw rows past `dataRetentionDays` (PRD F-51). Without it the table grows ~2.6M rows/month at 10 devices (`AUDIT.md` A-17).
- TanStack Query `staleTime`: 5s for live metrics, 5 minutes for device metadata.
- Device table paginates server-side beyond 50 rows.
