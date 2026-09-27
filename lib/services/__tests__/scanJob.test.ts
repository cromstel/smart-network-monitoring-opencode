import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { eventBusInstance, type AppEvent } from '@/lib/services/eventBus'
import { scanOnce } from '@/lib/services/scanJob'
import { listNotifications, createAlert } from '@/lib/db/repositories/alertRepository'
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

const MAC = 'AA:BB:CC:11:22:33'

function fakeScanner(macs: string[]) {
  return {
    name: 'simulated' as const,
    isAvailable: async () => true,
    scan: async () =>
      macs.map((mac, i) => ({
        macAddress: mac,
        ipAddress: `192.168.1.${100 + i}`,
        hostname: `host-${i}`,
      })),
  }
}

describe('scanJob — one connection, exactly one alert (B-50)', () => {
  let userId: string

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    await db.deleteFrom('notifications').execute()
    await db.deleteFrom('device_alerts').execute()
    await db.deleteFrom('devices').execute()
    await db.deleteFrom('users').execute()
    await db.deleteFrom('network_scan_history').execute()

    userId = randomUUID()
    const now = new Date().toISOString()
    await db
      .insertInto('users')
      .values({
        id: userId,
        email: `owner-${userId}@example.com`,
        password_hash: 'x',
        name: 'Owner',
        role: 'ADMIN',
        is_active: 1,
        created_at: now,
        updated_at: now,
      })
      .execute()

    // A global rule: "alert me about any new device".
    await createAlert({
      userId,
      deviceId: null,
      alertType: 'unknown_device',
      threshold: null,
    })
  })

  afterAll(async () => {
    eventBusInstance.clear()
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  it('raises one alert for a newly discovered device, not one per scan', async () => {
    const selectMock = jest
      .spyOn(require('@/lib/services/scanners/selector'), 'selectScanner')
      .mockResolvedValue(fakeScanner([MAC]) as never)

    const first = await scanOnce()
    expect(first.newDevices).toBe(1)

    const afterFirst = await listNotifications(userId)
    expect(afterFirst).toHaveLength(1)
    expect(afterFirst[0]?.type).toBe('unknown_device')

    // Three more scans of the same, already-known device.
    for (let i = 0; i < 3; i += 1) {
      const result = await scanOnce()
      expect(result.newDevices).toBe(0)
    }

    const afterRepeat = await listNotifications(userId)
    expect(afterRepeat).toHaveLength(1)

    selectMock.mockRestore()
  })

  it('emits device.connected once and device.disconnected when a device goes away', async () => {
    const events: AppEvent[] = []
    const off = eventBusInstance.on((e) => events.push(e))

    const selectMock = jest
      .spyOn(require('@/lib/services/scanners/selector'), 'selectScanner')
      .mockResolvedValue(fakeScanner([MAC]) as never)

    await scanOnce()
    const connected = events.filter((e) => e.type === 'device.connected')
    expect(connected).toHaveLength(1)

    // Now the device stops answering: empty scan + stale last_seen.
    const row = await db.selectFrom('devices').select('id').executeTakeFirstOrThrow()
    const longAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    await db
      .updateTable('devices')
      .set({ last_seen: longAgo })
      .where('id', '=', row.id)
      .execute()

    events.length = 0
    selectMock.mockResolvedValue(fakeScanner([]) as never)
    await scanOnce()

    const disconnected = events.filter((e) => e.type === 'device.disconnected')
    expect(disconnected).toHaveLength(1)

    const status = await db.selectFrom('devices').select('status').executeTakeFirstOrThrow()
    expect(status.status).toBe('offline')

    off()
    selectMock.mockRestore()
  })

  it('records a scan history row per cycle', async () => {
    const selectMock = jest
      .spyOn(require('@/lib/services/scanners/selector'), 'selectScanner')
      .mockResolvedValue(fakeScanner([MAC]) as never)

    await db.deleteFrom('network_scan_history').execute()
    await scanOnce()

    const rows = await db.selectFrom('network_scan_history').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('success')
    expect(Number(rows[0]?.device_count)).toBe(1)

    selectMock.mockRestore()
  })

  it('keeps scanning when one device fails to ingest', async () => {
    const good = 'AA:BB:CC:44:55:66'
    const bad = 'not-a-mac'

    const selectMock = jest
      .spyOn(require('@/lib/services/scanners/selector'), 'selectScanner')
      .mockResolvedValue(fakeScanner([good, bad]) as never)

    const result = await scanOnce()
    expect(result.errors).toBeGreaterThanOrEqual(1)

    // The healthy device was still recorded.
    const rows = await db.selectFrom('devices').select('mac_address').execute()
    expect(rows.map((r) => r.mac_address)).toContain(good.toUpperCase())

    const history = await db.selectFrom('network_scan_history').select('status').executeTakeFirstOrThrow()
    expect(history.status).toBe('partial')

    selectMock.mockRestore()
  })
})
