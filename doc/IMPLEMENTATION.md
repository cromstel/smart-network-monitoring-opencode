# Implementation Guide

Conventions and patterns. When a task in `TODO.md` says "per `IMPLEMENTATION.md`", this is what it means.

---

## 1. Working rhythm

1. Read `MEMORY.md`.
2. Take the top unticked task in `TODO.md`.
3. Read its audit reference in `AUDIT.md` if it has one.
4. Write the test first where the task has a clear input and output.
5. Implement the smallest change that satisfies the acceptance criteria.
6. Run `npm run type-check && npm test && npm run build`.
7. Tick the task. If a decision changed, add a line to `MEMORY.md` §5.

Do not batch tasks. One task, one verified state, then the next.

---

## 2. TypeScript

Strict mode is on and stays on.

- No `any`. Use `unknown` and narrow.
- No `@ts-ignore` without an adjacent comment naming the specific issue.
- No non-null assertion (`!`) on anything from the database or an API — handle the null.
- Domain types live in `lib/types/`. They are written by hand and owned by the app.

```ts
// lib/types/device.ts
export type DeviceStatus = 'online' | 'offline' | 'idle'

export interface Device {
  id: string
  macAddress: string          // uppercase, colon-separated
  ipAddress: string
  hostname: string | null
  deviceName: string | null   // user-set; falls back to hostname, then MAC
  deviceType: DeviceType
  manufacturer: string | null
  status: DeviceStatus
  firstSeen: Date
  lastSeen: Date
  isBlocked: boolean
}
```

`null` for absent, not `undefined`. The database returns `null`; translating at the edge just creates two ways to say the same thing.

---

## 3. Route handlers

Thin. Validate, call one service, shape the response.

```ts
// app/api/devices/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireRole } from '@/lib/auth/requireRole'
import { listDevices } from '@/lib/services/deviceService'
import { toDeviceDTO } from '@/lib/api/serialisers'

const querySchema = z.object({
  status: z.enum(['online', 'offline', 'idle']).optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(request: NextRequest) {
  const session = await requireRole(request, ['ADMIN', 'MEMBER', 'VIEWER'])
  if (!session.ok) return session.response

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  )
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'INVALID_QUERY', details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  const { devices, total } = await listDevices(parsed.data)

  return NextResponse.json({
    data: devices.map(toDeviceDTO),
    pagination: { page: parsed.data.page, pageSize: parsed.data.pageSize, total },
  })
}
```

Four things to notice:
- Authorisation is re-checked here, not only in middleware.
- `safeParse`, not `parse` — a validation failure is a 400, not a 500.
- The parsed object is what reaches the service, so an unvalidated field cannot slip through.
- A serialiser converts domain types to the wire shape. That is where `bigint` becomes `string` (`AUDIT.md` A-05) and where secrets are dropped.

---

## 4. Services

Business logic. The only layer that calls repositories.

```ts
// lib/services/deviceService.ts
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import * as bandwidthRepo from '@/lib/db/repositories/bandwidthRepository'
import type { Device } from '@/lib/types'

const MISSED_SCANS_BEFORE_OFFLINE = 2

export async function markStaleDevicesOffline(scanIntervalSeconds: number) {
  const cutoff = new Date(
    Date.now() - scanIntervalSeconds * MISSED_SCANS_BEFORE_OFFLINE * 1000
  )
  const stale = await deviceRepo.findOnlineLastSeenBefore(cutoff)

  for (const device of stale) {
    await deviceRepo.updateStatus(device.id, 'offline')
    await deviceRepo.logDisconnection(device.id, device.lastSeen)
  }
  return stale
}
```

The threshold constant lives here, not in the repository and not in the route handler. One definition of "offline".

---

## 5. Repositories

Data access only. No business rules.

```ts
// lib/db/repositories/deviceRepository.ts
import { db } from '@/lib/db/client'
import { randomUUID } from 'node:crypto'
import type { Device, DeviceStatus } from '@/lib/types'
import { rowToDevice } from './mappers'

export async function findOnlineLastSeenBefore(cutoff: Date): Promise<Device[]> {
  const rows = await db
    .selectFrom('devices')
    .selectAll()
    .where('status', '=', 'online')
    .where('last_seen', '<', cutoff.toISOString())
    .execute()

  return rows.map(rowToDevice)
}

export async function upsertFromScan(input: {
  macAddress: string
  ipAddress: string
  hostname: string | null
  manufacturer: string | null
}): Promise<void> {
  const now = new Date().toISOString()

  await db
    .insertInto('devices')
    .values({
      id: randomUUID(),
      mac_address: input.macAddress.toUpperCase(),
      ip_address: input.ipAddress,
      hostname: input.hostname,
      manufacturer: input.manufacturer,
      status: 'online',
      first_seen: now,
      last_seen: now,
      created_at: now,
      updated_at: now,
    })
    .onConflict((oc) =>
      oc.column('mac_address').doUpdateSet({
        ip_address: input.ipAddress,
        hostname: input.hostname,
        status: 'online',
        last_seen: now,
        updated_at: now,      // set explicitly — SQLite has no ON UPDATE
      })
    )
    .execute()
}
```

Notes that matter:
- `snake_case` columns, `camelCase` in TypeScript, translated by `mappers.ts`. One place to change.
- UUID generated in application code — `AUTO_INCREMENT` and `AUTOINCREMENT` differ between the dialects.
- MAC uppercased at write. SQLite compares case-sensitively; MySQL's default collation does not. Normalising at ingest removes the class of bug.
- `updated_at` set by hand. `ON UPDATE CURRENT_TIMESTAMP` does not exist in SQLite.
- `onConflict` compiles to `ON DUPLICATE KEY UPDATE` on MySQL and `ON CONFLICT DO UPDATE` on SQLite. This is the reason for the query builder.

---

## 6. React components

Server Components by default. `'use client'` only when the component needs state, an effect, or an event handler.

Server state comes from TanStack Query. Never `useState` + `useEffect` + `fetch`.

```ts
// lib/hooks/useDevices.ts
'use client'
import { useQuery } from '@tanstack/react-query'
import type { DeviceDTO } from '@/lib/types'

export const deviceKeys = {
  all: ['devices'] as const,
  list: (filters: DeviceFilters) => [...deviceKeys.all, 'list', filters] as const,
  detail: (id: string) => [...deviceKeys.all, 'detail', id] as const,
}

export function useDevices(filters: DeviceFilters) {
  return useQuery({
    queryKey: deviceKeys.list(filters),
    queryFn: async (): Promise<{ data: DeviceDTO[]; total: number }> => {
      const res = await fetch(`/api/devices?${new URLSearchParams(filters as any)}`)
      if (!res.ok) throw new Error(`Failed to load devices: ${res.status}`)
      return res.json()
    },
    staleTime: 5_000,
  })
}
```

The exported `deviceKeys` factory is what lets the SSE hook invalidate precisely:

```ts
queryClient.invalidateQueries({ queryKey: deviceKeys.all })
```

Without a key factory, invalidation becomes string-matching guesswork scattered across files.

Every component that renders async data handles three states: loading (skeleton, not a spinner, not `null`), error (message plus retry), and empty (explain what would fill it).

---

## 7. Errors

Route handlers return a stable shape:

```ts
{ error: 'MACHINE_READABLE_CODE', message: 'Human sentence.', details?: unknown }
```

Codes: `INVALID_QUERY` · `INVALID_BODY` · `UNAUTHENTICATED` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `ROUTER_UNREACHABLE` · `SCANNER_UNAVAILABLE` · `INTERNAL`.

Never return a raw exception message to a client — stack traces and connection strings leak that way. Log the exception with full context server-side; return `INTERNAL` with a generic sentence.

---

## 8. Logging

`pino`, structured, with redaction:

```ts
// lib/utils/logger.ts
import pino from 'pino'

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['password', 'routerPassword', 'token', 'secret', '*.authorization', '*.cookie'],
})
```

Log events with context, not prose:

```ts
logger.info({ scanner: 'arp', found: devices.length, durationMs }, 'scan complete')
logger.warn({ scanner: 'arp', reason: 'CAP_NET_RAW missing', fallback: 'simulated' }, 'scanner unavailable')
```

---

## 9. Naming

| Thing | Convention | Example |
|---|---|---|
| Database table | plural snake_case | `bandwidth_metrics` |
| Database column | snake_case | `download_speed` |
| TypeScript | camelCase | `downloadSpeed` |
| Type / interface | PascalCase, singular | `BandwidthMetric` |
| Component file | PascalCase | `DeviceCard.tsx` |
| Hook | `use` + camelCase | `useDevices.ts` |
| Service file | camelCase + `Service` | `deviceService.ts` |
| Repository file | camelCase + `Repository` | `deviceRepository.ts` |
| Constant | SCREAMING_SNAKE | `MISSED_SCANS_BEFORE_OFFLINE` |
| Migration | `NNN_snake_case.ts` | `002_bandwidth_metrics.ts` |

---

## 10. Definition of done

A task is done when all of these hold:

- [ ] Acceptance criteria in `TODO.md` are met
- [ ] `npm run type-check` — 0 errors
- [ ] `npm test` — green
- [ ] `npm run build` — succeeds
- [ ] New logic has a test; a fixed bug has a regression test
- [ ] No `console.log` (use `logger`), no commented-out code, no `TODO` without a `B-nn` reference
- [ ] It works against a live database, not a mock

That last line is the one that gets skipped. Don't skip it. A cross-user notification bug on a related project survived unit tests and was only caught running against a real database.
