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

import { getEffectiveScanSettings, getEffectiveRetentionSettings } from '@/lib/services/runtimeSettings'
import { isNotificationEnabled } from '@/lib/services/notificationPreferences'
import { upsertUserSettings } from '@/lib/db/repositories/settingsRepository'

/**
 * Regression cover for the write-only-settings defect.
 *
 * Every one of these assertions fails against the previous behaviour, where the
 * runtime read `getConfig()` (the environment) and ignored `user_settings`
 * entirely. They are written against the *resolved* value, not the row, so
 * they pin the thing that actually matters: what the running system uses.
 */

async function createUser(email: string): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()
  await db
    .insertInto('users')
    .values({
      id,
      email,
      password_hash: 'x',
      name: 'Owner',
      role: 'ADMIN',
      is_active: 1,
      created_at: now,
      updated_at: now,
    })
    .execute()
  return id
}

// One migration and one teardown for the whole file: `db` is a cached module
// singleton, so a second `db.destroy()` would close a client the other describe
// block is still using.
beforeAll(async () => {
  const result = await createMigrator(db).migrateToLatest()
  if (result.error) throw result.error
})

afterAll(async () => {
  await db.destroy()
  delete (globalThis as { __db?: unknown }).__db
})

describe('runtimeSettings — saved settings actually drive the runtime', () => {
  beforeEach(async () => {
    await db.deleteFrom('user_settings').execute()
    await db.deleteFrom('users').execute()
  })

  it('falls back to the environment when no settings row exists', async () => {
    const scan = await getEffectiveScanSettings()
    expect(scan).toEqual({
      subnet: '192.168.1.0/24',
      scanIntervalSeconds: 30,
      source: 'env',
    })

    const retention = await getEffectiveRetentionSettings()
    expect(retention).toEqual({ dataRetentionDays: 30, source: 'env' })
  })

  it('prefers a saved subnet and interval over the environment', async () => {
    const userId = await createUser('admin@example.com')
    await upsertUserSettings({
      userId,
      networkSubnet: '10.20.30.0/24',
      scanIntervalSeconds: 120,
      dataRetentionDays: 7,
    })

    const scan = await getEffectiveScanSettings()
    expect(scan.subnet).toBe('10.20.30.0/24')
    expect(scan.scanIntervalSeconds).toBe(120)
    expect(scan.source).toBe('settings')

    const retention = await getEffectiveRetentionSettings()
    expect(retention.dataRetentionDays).toBe(7)
    expect(retention.source).toBe('settings')
  })

  it('resolves the same row regardless of insertion order', async () => {
    // Two admins may both have saved settings. The resolver must be
    // deterministic, otherwise the effective subnet changes between calls.
    const first = await createUser('zzz-admin@example.com')
    const second = await createUser('aaa-admin@example.com')
    await upsertUserSettings({ userId: first, networkSubnet: '10.0.0.0/24' })
    await upsertUserSettings({ userId: second, networkSubnet: '10.1.0.0/24' })

    // Which row wins is not observable from here (ids are UUIDs), but it must
    // be the *same* row every time — a non-deterministic pick would make the
    // effective subnet flip between scans.
    const results = await Promise.all([
      getEffectiveScanSettings(),
      getEffectiveScanSettings(),
      getEffectiveScanSettings(),
    ])
    expect(new Set(results.map((r) => r.subnet)).size).toBe(1)
    expect(['10.0.0.0/24', '10.1.0.0/24']).toContain(results[0].subnet)
  })

  it('degrades to the environment instead of throwing when the read fails', async () => {
    const spy = jest
      .spyOn(db, 'selectFrom')
      .mockImplementationOnce(() => {
        throw new Error('table is gone')
      })

    await expect(getEffectiveScanSettings()).resolves.toEqual({
      subnet: '192.168.1.0/24',
      scanIntervalSeconds: 30,
      source: 'env',
    })

    spy.mockRestore()
  })
})

describe('notificationPreferences — the toggles gate real alerts (F-52)', () => {
  beforeEach(async () => {
    await db.deleteFrom('user_settings').execute()
    await db.deleteFrom('users').execute()
  })

  it('returns true for an owner with no settings row (fails open)', async () => {
    const userId = await createUser('nogalerts@example.com')
    // Deliberate: no settings row. An absent preference must not silence alerts.
    await expect(isNotificationEnabled(userId, 'unknown_device')).resolves.toBe(true)
  })

  it('honours a toggle that was switched off', async () => {
    const userId = await createUser('muted@example.com')
    await upsertUserSettings({ userId, notifyNewDevices: false })

    await expect(isNotificationEnabled(userId, 'unknown_device')).resolves.toBe(false)
    // The other types are untouched, so this is per-type, not a global mute.
    await expect(isNotificationEnabled(userId, 'device_offline')).resolves.toBe(true)
  })

  it('maps each alert type to its own toggle', async () => {
    const userId = await createUser('mixed@example.com')
    await upsertUserSettings({
      userId,
      notifyNewDevices: true,
      notifyDeviceOffline: false,
      notifyHighBandwidth: true,
    })

    await expect(isNotificationEnabled(userId, 'unknown_device')).resolves.toBe(true)
    await expect(isNotificationEnabled(userId, 'device_offline')).resolves.toBe(false)
    await expect(isNotificationEnabled(userId, 'bandwidth_exceeded')).resolves.toBe(true)
  })

  it('returns true for an unrecognised alert type rather than muting it', async () => {
    const userId = await createUser('other@example.com')
    await upsertUserSettings({ userId, notifyNewDevices: false })
    await expect(isNotificationEnabled(userId, 'some_future_type')).resolves.toBe(true)
  })
})
