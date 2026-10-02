import { randomUUID } from 'node:crypto'
import { createTestDb } from './harness'
import type { TestDb } from './harness'
import * as deviceRepo from '../repositories/deviceRepository'
import * as bandwidthRepo from '../repositories/bandwidthRepository'

const ACTIVE: Array<'sqlite' | 'mysql'> =
  process.env.DB_CLIENT === 'mysql' ? ['mysql'] : ['sqlite']

interface Seed {
  id: string
  mac: string
  ip: string
}

function seedDevice(overrides: Partial<Seed> = {}): Seed {
  const hex = randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()
  const mac = Array.from({ length: 6 }, (_, i) => hex.slice(i * 2, i * 2 + 2)).join(':')
  return {
    id: overrides.id ?? randomUUID(),
    mac: overrides.mac ?? mac,
    ip: overrides.ip ?? '192.168.1.42',
  }
}

describe.each(ACTIVE)('deviceRepository (client: %s)', (dialect) => {
  let t: TestDb

  beforeAll(async () => {
    t = await createTestDb()
    // Guard: the harness chose the dialect the run is pinned to.
    expect(t.client).toBe(dialect)
  })

  beforeEach(async () => {
    await t.reset()
  })

  afterAll(async () => {
    await t.destroy()
  })

  it('upserts from a scan: inserts then updates the same MAC, keeping the id', async () => {
    const device = seedDevice()

    await deviceRepo.upsertFromScan({
      macAddress: device.mac,
      ipAddress: device.ip,
      hostname: 'first-scan',
      manufacturer: 'Apple, Inc.',
    })
    await deviceRepo.upsertFromScan({
      macAddress: device.mac,
      ipAddress: '192.168.1.99',
      hostname: 'second-scan',
      manufacturer: 'Apple, Inc.',
    })

    const all = await deviceRepo.listDevices({})
    expect(all.data).toHaveLength(1)
    expect(all.data[0].macAddress).toBe(device.mac.toUpperCase())
    expect(all.data[0].hostname).toBe('second-scan')
    expect(all.data[0].ipAddress).toBe('192.168.1.99')
    expect(all.data[0].status).toBe('online')
  })

  it('filters by status and type, and applies pagination', async () => {
    for (let i = 0; i < 5; i += 1) {
      await deviceRepo.upsertFromScan({
        macAddress: seedDevice({ ip: `192.168.1.${10 + i}` }).mac,
        ipAddress: `192.168.1.${10 + i}`,
        hostname: `dev-${i}`,
        manufacturer: null,
      })
    }

    const page = await deviceRepo.listDevices({ page: 1, pageSize: 2 })
    expect(page.data).toHaveLength(2)
    expect(page.pagination.total).toBe(5)

    const offline = await deviceRepo.listDevices({ status: 'offline' })
    expect(offline.pagination.total).toBe(0)
  })

  it('searches across name, hostname, IP and MAC', async () => {
    await deviceRepo.upsertFromScan({
      macAddress: '3C:22:FB:44:90:12',
      ipAddress: '192.168.1.43',
      hostname: 'anas-macbook',
      manufacturer: null,
    })
    await deviceRepo.upsertFromScan({
      macAddress: '5C:91:00:BB:12:AA',
      ipAddress: '192.168.1.44',
      hostname: 'unrelated',
      manufacturer: null,
    })

    expect((await deviceRepo.listDevices({ search: 'anas-macbook' })).pagination.total).toBe(1)
    expect((await deviceRepo.listDevices({ search: '192.168.1.44' })).pagination.total).toBe(1)
    expect((await deviceRepo.listDevices({ search: '3C:22:FB' })).pagination.total).toBe(1)
  })

  it('searches case-insensitively, on both engines', async () => {
    // Found by an E2E flake rather than by reading the code. `LIKE` is
    // case-sensitive on MySQL 8.4 and case-insensitive on SQLite for ASCII, so
    // the identical query returned different answers depending on the engine:
    // a user searching `nas` found "NAS Server" on SQLite and nothing on MySQL.
    // People do not think of a search box is case-sensitive, so both sides of
    // the comparison are lowercased.
    //
    // Verified to bite: removing `lower()` from the query fails this on MySQL
    // 8.4 (8 of 8 tests fail) and still passes on SQLite, which is exactly why
    // the dual-dialect suite exists.
    await deviceRepo.upsertFromScan({
      macAddress: 'AA:00:00:00:00:01',
      ipAddress: '192.168.1.90',
      hostname: 'synology-nas',
      manufacturer: null,
    })
    await deviceRepo.upsertFromScan({
      macAddress: 'AA:00:00:00:00:02',
      ipAddress: '192.168.1.91',
      hostname: 'unrelated-box',
      manufacturer: null,
    })

    for (const term of ['NAS', 'nas', 'Nas', 'nAs']) {
      const found = await deviceRepo.listDevices({ search: term })
      expect({ term, total: found.pagination.total }).toEqual({ term, total: 1 })
    }
  })

  it('treats LIKE wildcards in a search term as literal characters', async () => {
    // Without escaping, searching for `50%` matches every row, because `%` is a
    // wildcard. `_` is a single-character wildcard and has the same problem.
    // The hostnames below contain the literal characters, not the substrings
    // `50-percent` and `disk_plenty`, so a match proves real escaping rather
    // than an incidental substring hit.
    await deviceRepo.upsertFromScan({
      macAddress: 'BB:00:00:00:00:01',
      ipAddress: '192.168.1.80',
      hostname: 'backup-50%-of-total',
      manufacturer: null,
    })
    await deviceRepo.upsertFromScan({
      macAddress: 'BB:00:00:00:00:02',
      ipAddress: '192.168.1.81',
      hostname: 'backup-plenty-of-total',
      manufacturer: null,
    })
    await deviceRepo.upsertFromScan({
      macAddress: 'BB:00:00:00:00:03',
      ipAddress: '192.168.1.82',
      hostname: 'slot_A_free',
      manufacturer: null,
    })

    // Only the row whose hostname literally contains "50%" may match. An
    // unescaped `%` here would match both backup rows.
    const pct = await deviceRepo.listDevices({ search: '50%' })
    expect(pct.pagination.total).toBe(1)
    expect(pct.data[0]?.hostname).toBe('backup-50%-of-total')

    // A bare `_` must match one literal underscore, not any single character.
    const underscore = await deviceRepo.listDevices({ search: 'slot_A_free' })
    expect(underscore.pagination.total).toBe(1)
    expect(underscore.data[0]?.hostname).toBe('slot_A_free')

    // And it must not behave as a wildcard: `slot_X_free` is not a literal
    // substring of anything, so an unescaped `_` would have matched the row
    // above.
    expect((await deviceRepo.listDevices({ search: 'slot_X_free' })).pagination.total).toBe(0)
  })

  it('updates a device and nulls a name, persisting through a read', async () => {
    const device = seedDevice()
    await deviceRepo.upsertFromScan({
      macAddress: device.mac,
      ipAddress: device.ip,
      hostname: 'old-name',
      manufacturer: null,
    })

    const found = (await deviceRepo.listDevices({ search: 'old-name' })).data[0]
    expect(found).toBeDefined()

    const updated = await deviceRepo.update(found.id, {
      deviceName: 'Living Room TV',
      deviceType: 'tv',
      categoryId: null,
      isIgnored: true,
    })
    expect(updated?.deviceName).toBe('Living Room TV')
    expect(updated?.deviceType).toBe('tv')
    expect(updated?.isIgnored).toBe(true)

    const cleared = await deviceRepo.update(found.id, { deviceName: null })
    expect(cleared?.deviceName).toBeNull()

    const reread = await deviceRepo.findById(found.id)
    expect(reread?.deviceName).toBeNull()
  })

  it('marks devices offline after the staleness cutoff', async () => {
    const staleId = randomUUID()
    await t.db
      .insertInto('devices')
      .values({
        id: staleId,
        mac_address: 'AA:BB:CC:DD:EE:01',
        ip_address: '192.168.1.10',
        device_type: 'iot',
        status: 'online',
        total_connection_time: 0,
        first_seen: '2026-01-01T00:00:00.000Z',
        last_seen: '2026-09-24T09:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-09-24T09:00:00.000Z',
      })
      .execute()

    const stale = await deviceRepo.findOnlineLastSeenBefore(new Date('2026-09-24T10:00:00.000Z'))
    expect(stale.map((d) => d.id)).toEqual([staleId])

    await deviceRepo.updateStatus(staleId, 'offline')
    expect((await deviceRepo.findById(staleId))?.status).toBe('offline')
  })

  it('round-trips BIGINT byte counters exactly past 2^53', async () => {
    const device = seedDevice()
    await deviceRepo.upsertFromScan({
      macAddress: device.mac,
      ipAddress: device.ip,
      hostname: 'bigint-dev',
      manufacturer: null,
    })

    const found = await deviceRepo.findOnlineLastSeenBefore(new Date('2999-01-01T00:00:00.000Z'))
    const id = found.find((d) => d.hostname === 'bigint-dev')!.id

    await bandwidthRepo.insertBandwidthMetric({
      deviceId: id,
      timestamp: new Date('2026-09-24T10:00:00.000Z'),
      uploadSpeed: 1.5,
      downloadSpeed: 9.9,
      uploadTotal: '9007199254740993', // 2^53 + 1
      downloadTotal: '4611686018427387904', // 2^62
    })

    const stats = await bandwidthRepo.fetchStatsForDevices([id])
    const s = stats.get(id)
    expect(s?.uploadBytes).toBe('9007199254740993')
    expect(s?.downloadBytes).toBe('4611686018427387904')
  })
})