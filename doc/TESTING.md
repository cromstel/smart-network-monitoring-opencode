# Testing Strategy

The test infrastructure currently does not run: `jest.config.js`, `jest.setup.js`, and 6 test files exist, but `package.json` has no test dependencies and no `test` script (`AUDIT.md` A-04). `TODO.md` B-06 fixes that first.

---

## Shape

```
        ╱  E2E (Playwright) — 5 specs, the journeys that must never break
      ╱────  Integration (Jest) — route handler → service → repository → real DB
    ╱──────── Unit (Jest) — services, repositories, utils, hooks, components
```

Weighted toward the middle. Unit tests are fast but missed the bug that mattered most on a related project; the cross-user notification leak only appeared when the full path ran against a real database.

---

## Setup (B-06)

```json
"devDependencies": {
  "jest": "^29.7.0",
  "jest-environment-jsdom": "^29.7.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/jest-dom": "^6.4.0",
  "@testing-library/user-event": "^14.5.0",
  "@types/jest": "^29.5.0",
  "ts-node": "^10.9.0",
  "@playwright/test": "^1.47.0"
},
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:mysql": "DB_CLIENT=mysql jest --testPathPattern=integration",
  "test:e2e": "playwright test"
}
```

Verify `jest.config.js` maps the `@/` alias — the existing test files import through it and will fail to resolve otherwise.

---

## Unit

### Services
Mock the repository, not the database. The service under test should be the only real thing.

```ts
jest.mock('@/lib/db/repositories/deviceRepository')

it('marks a device offline after two missed scans', async () => {
  const stale = { id: 'd1', lastSeen: new Date(Date.now() - 61_000), status: 'online' }
  jest.mocked(deviceRepo.findOnlineLastSeenBefore).mockResolvedValue([stale] as any)

  await markStaleDevicesOffline(30)

  expect(deviceRepo.updateStatus).toHaveBeenCalledWith('d1', 'offline')
})
```

### Utils
Pure functions, table-driven. `lib/utils/format.ts` and `validation.ts` already have tests — get them running before writing new ones.

```ts
it.each([
  [0, '0 B'],
  [1023, '1023 B'],
  [1024, '1.0 KB'],
  [1_073_741_824, '1.0 GB'],
  ['9007199254740993', '8.0 PB'],   // beyond MAX_SAFE_INTEGER, as a string
])('formats %s as %s', (input, expected) => {
  expect(formatBytes(input)).toBe(expected)
})
```

That last row is the regression guard for `AUDIT.md` A-05.

### Components
Test behaviour, not markup. Query by role and label, not by class name or test id where an accessible query exists.

```ts
it('shows the MAC address when no name or hostname is set', () => {
  render(<DeviceCard device={build({ deviceName: null, hostname: null,
                                     macAddress: 'A4:83:E7:2C:11:09' })} />)
  expect(screen.getByText('A4:83:E7:2C:11:09')).toBeInTheDocument()
})
```

### Hooks
Wrap in a fresh `QueryClientProvider` per test with `retry: false`, so a failing query fails immediately instead of retrying for the duration of the timeout.

---

## Integration

The layer that earns its keep. Real database, real migrations, no mocks.

```ts
describe.each(['sqlite', 'mysql'] as const)('deviceRepository [%s]', (client) => {
  let db: Kysely<DB>
  beforeAll(async () => { db = await createTestDb(client); await migrateToLatest(db) })
  afterEach(async () => { await truncateAll(db) })
  afterAll(async () => { await db.destroy() })

  it('upserts on MAC conflict rather than duplicating', async () => {
    await upsertFromScan({ macAddress: 'A4:83:E7:2C:11:09', ipAddress: '192.168.1.42', ... })
    await upsertFromScan({ macAddress: 'a4:83:e7:2c:11:09', ipAddress: '192.168.1.99', ... })

    const all = await findAll()
    expect(all).toHaveLength(1)           // lowercase input must not create a second row
    expect(all[0].ipAddress).toBe('192.168.1.99')
  })
})
```

Running the same suite against both dialects is the whole reason for it. The upsert case above passes on MySQL's default collation and fails on SQLite's binary comparison unless MAC addresses are normalised at write — exactly the class of bug the dual-dialect decision creates.

### The test that must exist before the feature

`TODO.md` B-51. Write it first.

```ts
it('never delivers one user\'s alert to another user', async () => {
  const [ana, sam] = await Promise.all([createUser('ana'), createUser('sam')])
  await createAlert({ userId: ana.id, alertType: 'bandwidth_exceeded', threshold: 10 })

  await evaluateAlerts({ deviceId: device.id, downloadMbps: 50 })

  expect(await notificationsFor(ana.id)).toHaveLength(1)
  expect(await notificationsFor(sam.id)).toHaveLength(0)
})
```

A version of this bug has shipped before. The test is not a formality.

### Route handlers
Call the exported `GET`/`POST` directly with a constructed `NextRequest` against a seeded database. Assert status, envelope shape, and — for every mutating route — that a VIEWER session gets 403 (`TODO.md` B-34).

---

## E2E (Playwright)

Five specs, each a journey a user would notice breaking:

1. First-run setup → create ADMIN → land on the dashboard
2. Log in → device list renders with seeded devices
3. Rename a device → the new name persists after reload
4. Open device detail → switch range to 7d → chart renders
5. Create a bandwidth alert → trigger it → the notification appears

Run against a seeded database and `SCANNER_MODE=simulated`, so runs are deterministic.

Playwright's browser CDN is unreachable in the sandbox (`MEMORY.md` §6). Write the specs; expect them to execute in CI. Do not treat "cannot run locally" as a reason to skip writing them.

---

## Coverage

| Area | Target |
|---|---|
| `lib/services/` | 80% |
| `lib/db/repositories/` | 80% |
| `lib/utils/` | 90% |
| `components/` | 60% |
| `app/api/` | covered by integration, not counted here |

Enforce in `jest.config.js` via `coverageThreshold` so the number cannot quietly slip. 70% overall is the release gate (`PRD` §7).

Coverage measures what ran, not what was checked. A suite at 90% with no assertion about alert ownership is worse than one at 65% that has the leak test.

---

## Fixtures

Builders with overrides, not fixed objects. `__tests__/mocks/factories.ts` already exists — extend it.

```ts
export const buildDevice = (o: Partial<Device> = {}): Device => ({
  id: randomUUID(),
  macAddress: 'A4:83:E7:2C:11:09',
  ipAddress: '192.168.1.42',
  hostname: 'test-device',
  deviceName: null,
  deviceType: 'unknown',
  manufacturer: 'Apple, Inc.',
  status: 'online',
  firstSeen: new Date('2026-01-01T00:00:00Z'),
  lastSeen: new Date('2026-01-01T00:00:00Z'),
  isBlocked: false,
  ...o,
})
```

Fixed dates, not `new Date()` — a test that depends on the current time fails at a boundary someone else will have to debug.

---

## CI (B-62)

```
lint  →  type-check  →  unit  →  integration (MySQL service)  →  build  →  e2e
```

Every stage blocks the merge. The MySQL integration stage runs against a real MySQL 8 service container, not SQLite — otherwise the dual-dialect risk is untested precisely where it matters.
