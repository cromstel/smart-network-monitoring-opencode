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