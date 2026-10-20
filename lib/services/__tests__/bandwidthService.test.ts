import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { randomUUID } from 'node:crypto'

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({
    DB_CLIENT: 'sqlite',
    NETWORK_SUBNET: '192.168.1.0/24',
    SCANNER_MODE: 'simulated',
    SCAN_INTERVAL_SECONDS: 30,
    DATA_RETENTION_DAYS: 30,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  })),
}))

import {
  recordBandwidthSamples,
  resetBandwidthSampler,
  __setBandwidthClock,
} from '@/lib/services/bandwidthService'
import { findLatestForDevice, listForDeviceBetween } from '@/lib/db/repositories/bandwidthRepository'

const MAC = 'A4:83:E7:2C:11:09'

/**
 * The sampler divides by *actual* elapsed time. Tests advance this clock by a
 * realistic scan interval so the assertion measures the byte->Mbps conversion
 * rather than a divide-by-near-zero. Anchored to the real clock so stored
 * timestamps still fall inside a `Date.now()`-based range query.
 */
let clockNow = Date.now()

function advanceClock(seconds: number): void {
  clockNow += seconds * 1000
}

async function seedDevice(mac: string): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await db
    .insertInto('devices')
    .values({
      id,
      mac_address: mac,
      ip_address: '192.168.1.42',
      hostname: 'test-device',
      device_name: null,
      device_type: 'unknown',
      manufacturer: null,
      signal_strength: null,
      status: 'online',
      is_blocked: 0,
      is_ignored: 0,
      total_connection_time: 0,
      category_id: null,
      first_seen: now,
      last_seen: now,
      created_at: now,
      updated_at: now,
    })
    .execute()
  return id
}

describe('bandwidthService — the missing producer for bandwidth_metrics', () => {
  let deviceId: string

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    resetBandwidthSampler()
    clockNow = Date.now()
    __setBandwidthClock(() => clockNow)
    await db.deleteFrom('bandwidth_metrics').execute()
    await db.deleteFrom('devices').execute()
    deviceId = await seedDevice(MAC)
  })

  afterAll(async () => {
    __setBandwidthClock(null)
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  it('writes nothing on the first observation, because a rate needs two samples', async () => {
    const samples = await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 1_000_000, downloadBytes: 5_000_000 } },
    ])

    expect(samples).toHaveLength(0)
    // The critical assertion: no phantom spike from dividing lifetime traffic
    // by a single interval.
    expect(await findLatestForDevice(deviceId)).toBeNull()
  })

  it('derives a Mbps rate from the delta on the second observation', async () => {
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 0, downloadBytes: 0 } },
    ])

    // 30 MB down + 10 MB up over a 30s interval => 8 Mbps down, 2.667 up.
    advanceClock(30)
    const samples = await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 10_000_000, downloadBytes: 30_000_000 } },
    ])

    expect(samples).toHaveLength(1)
    expect(samples[0].downloadMbps).toBeCloseTo(8, 1)
    expect(samples[0].uploadMbps).toBeCloseTo(2.667, 1)

    const stored = await findLatestForDevice(deviceId)
    expect(stored).not.toBeNull()
    expect(stored!.downloadSpeed).toBeCloseTo(8, 1)
  })

  it('keeps cumulative totals monotonic across samples', async () => {
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 1_000, downloadBytes: 2_000 } },
    ])
    advanceClock(30)
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 101_000, downloadBytes: 202_000 } },
    ])
    const second = await findLatestForDevice(deviceId)

    advanceClock(30)
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 201_000, downloadBytes: 402_000 } },
    ])
    const third = await findLatestForDevice(deviceId)

    expect(Number(third!.uploadTotal)).toBeGreaterThan(Number(second!.uploadTotal))
    expect(Number(third!.downloadTotal)).toBeGreaterThan(Number(second!.downloadTotal))
  })

  it('treats a counter reset as unknown rather than a huge negative rate', async () => {
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 900_000_000, downloadBytes: 900_000_000 } },
    ])

    // Router rebooted: counters restart near zero.
    advanceClock(30)
    const samples = await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 1_000, downloadBytes: 1_000 } },
    ])

    expect(samples).toHaveLength(0)
  })

  it('records one sample per device when several report traffic', async () => {
    const otherMac = '3C:22:FB:44:90:12'
    await seedDevice(otherMac)

    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 0, downloadBytes: 0 } },
      { macAddress: otherMac, traffic: { uploadBytes: 0, downloadBytes: 0 } },
    ])

    advanceClock(30)
    const samples = await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 1_000_000, downloadBytes: 1_000_000 } },
      { macAddress: otherMac, traffic: { uploadBytes: 1_000_000, downloadBytes: 1_000_000 } },
    ])

    expect(samples).toHaveLength(2)
  })

  it('does not manufacture a spike when two samples arrive back to back', async () => {
    // A real scan can return in milliseconds. Without the elapsed-time floor,
    // 40 MB measured over ~0.02s would report >10000 Mbps and falsely fire a
    // bandwidth alert on any link.
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 0, downloadBytes: 0 } },
    ])
    // Deliberately no clock advance.
    const samples = await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 10_000_000, downloadBytes: 30_000_000 } },
    ])

    expect(samples).toHaveLength(1)
    // 40 MB over the 2s floor => 160 Mbps, not 16000.
    expect(samples[0].downloadMbps).toBeLessThan(200)
  })

  it('does nothing at all when no device reports traffic', async () => {
    const samples = await recordBandwidthSamples([
      { macAddress: MAC },
      { macAddress: '00:11:22:33:44:55' },
    ])
    expect(samples).toHaveLength(0)
  })

  it('skips a device with no matching row instead of throwing', async () => {
    await recordBandwidthSamples([
      { macAddress: 'FF:FF:FF:FF:FF:FF', traffic: { uploadBytes: 0, downloadBytes: 0 } },
    ])

    await expect(
      recordBandwidthSamples([
        { macAddress: 'FF:FF:FF:FF:FF:FF', traffic: { uploadBytes: 9_000_000, downloadBytes: 9_000_000 } },
      ])
    ).resolves.toHaveLength(0)
  })

  it('produces a history that the range query can read back (F-22)', async () => {
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 0, downloadBytes: 0 } },
    ])
    advanceClock(30)
    await recordBandwidthSamples([
      { macAddress: MAC, traffic: { uploadBytes: 10_000_000, downloadBytes: 10_000_000 } },
    ])

    const from = new Date(Date.now() - 60 * 60 * 1000)
    const to = new Date(Date.now() + 60 * 1000)
    const history = await listForDeviceBetween(deviceId, from, to)

    expect(history).toHaveLength(1)
  })
})
