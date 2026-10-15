import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { getUserSettings, saveUserSettings } from '../settingsService'
import {
  createAlert,
  deleteAlert,
  getUserAlerts,
  getUserNotifications,
  markNotificationRead,
  updateAlert,
  countUnread,
} from '../alertService'
import * as settingsRepo from '@/lib/db/repositories/settingsRepository'
import * as alertRepo from '@/lib/db/repositories/alertRepository'

jest.mock('@/lib/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}))

describe('settings and alert services', () => {
  let userId: string

  beforeAll(async () => {
    const result = await createMigrator(db).migrateToLatest()
    if (result.error) throw result.error
  })

  beforeEach(async () => {
    await db.deleteFrom('notifications').execute()
    await db.deleteFrom('device_alerts').execute()
    await db.deleteFrom('user_settings').execute()
    await db.deleteFrom('users').execute()

    userId = randomUUID()
    const now = new Date().toISOString()
    await db
      .insertInto('users')
      .values({
        id: userId,
        email: `svc-${userId}@example.com`,
        password_hash: 'x',
        name: 'Service User',
        role: 'ADMIN',
        is_active: 1,
        created_at: now,
        updated_at: now,
      })
      .execute()
  })

  afterAll(async () => {
    await db.destroy()
    delete (globalThis as { __db?: unknown }).__db
  })

  describe('getUserSettings', () => {
    it('creates defaults on first access', async () => {
      const settings = await getUserSettings(userId)

      expect(settings.userId).toBe(userId)
      expect(settings.scanIntervalSeconds).toBe(30)
      expect(settings.dataRetentionDays).toBe(30)
      expect(settings.networkSubnet).toBe('192.168.1.0/24')
      expect(settings.theme).toBe('dark')
      expect(settings.notifyNewDevices).toBe(true)
      expect(settings.notifyDeviceOffline).toBe(true)
      expect(settings.notifyHighBandwidth).toBe(false)
    })

    it('returns the same row on subsequent calls', async () => {
      const first = await getUserSettings(userId)
      const second = await getUserSettings(userId)

      expect(second.id).toBe(first.id)
    })
  })

  describe('saveUserSettings', () => {
    it('persists a partial patch and leaves other fields alone', async () => {
      await getUserSettings(userId)

      const updated = await saveUserSettings(userId, { scanIntervalSeconds: 120 })

      expect(updated.scanIntervalSeconds).toBe(120)
      expect(updated.dataRetentionDays).toBe(30)
      expect(updated.networkSubnet).toBe('192.168.1.0/24')
    })

    it('persists booleans as 0/1 rather than dropping them', async () => {
      await getUserSettings(userId)

      const off = await saveUserSettings(userId, { notifyNewDevices: false })
      expect(off.notifyNewDevices).toBe(false)

      const row = await settingsRepo.findUserSettings(userId)
      expect(row?.notifyNewDevices).toBe(false)

      const backOn = await saveUserSettings(userId, { notifyNewDevices: true })
      expect(backOn.notifyNewDevices).toBe(true)
    })

    it('works on a user that has no settings row yet', async () => {
      const saved = await saveUserSettings(userId, { bandwidthThreshold: 250 })
      expect(saved.bandwidthThreshold).toBe(250)
    })

    it('keeps settings isolated per user', async () => {
      const otherId = randomUUID()
      const now = new Date().toISOString()
      await db
        .insertInto('users')
        .values({
          id: otherId,
          email: `other-${otherId}@example.com`,
          password_hash: 'x',
          name: 'Other',
          role: 'MEMBER',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()

      await saveUserSettings(userId, { scanIntervalSeconds: 60 })
      await getUserSettings(otherId)

      expect((await getUserSettings(userId)).scanIntervalSeconds).toBe(60)
      expect((await getUserSettings(otherId)).scanIntervalSeconds).toBe(30)
    })
  })

  // B-67: PayStack credentials live in the same table as every other setting,
  // so the same partial-patch rules apply. The empty-string default matters
  // most: a row created by an older migration (or by a seed script that
  // inserts only id and user_id) reads back as '' rather than null, which is
  // what UserSettings declares.
  describe('PayStack billing (B-67)', () => {
    it('defaults every credential to an empty string', async () => {
      const settings = await getUserSettings(userId)

      expect(settings.paystackApiUrl).toBe('')
      expect(settings.paystackSecret).toBe('')
      expect(settings.paystackAccessToken).toBe('')
      expect(settings.paystackSubscriptionId).toBe('')
    })

    it('persists all four fields and reads them back', async () => {
      await saveUserSettings(userId, {
        paystackApiUrl: 'https://api.paystack.co',
        paystackSecret: 'sk_test_abc',
        paystackAccessToken: 'tok_abc',
        paystackSubscriptionId: 'SUB_123',
      })

      const row = await settingsRepo.findUserSettings(userId)
      expect(row?.paystackApiUrl).toBe('https://api.paystack.co')
      expect(row?.paystackSecret).toBe('sk_test_abc')
      expect(row?.paystackAccessToken).toBe('tok_abc')
      expect(row?.paystackSubscriptionId).toBe('SUB_123')
    })

    it('updates one field without clearing the others', async () => {
      await saveUserSettings(userId, {
        paystackApiUrl: 'https://api.paystack.co',
        paystackSecret: 'sk_test_abc',
        paystackAccessToken: 'tok_abc',
        paystackSubscriptionId: 'SUB_123',
      })

      const updated = await saveUserSettings(userId, { paystackSubscriptionId: 'SUB_999' })

      // Untouched fields keep their stored values — this is the write-only
      // credential contract the settings form depends on.
      expect(updated.paystackSecret).toBe('sk_test_abc')
      expect(updated.paystackAccessToken).toBe('tok_abc')
      expect(updated.paystackSubscriptionId).toBe('SUB_999')
    })

    it('writes the credentials on a row that does not exist yet', async () => {
      const saved = await saveUserSettings(userId, {
        paystackApiUrl: 'https://api.paystack.co',
        paystackSecret: 'sk_test_new',
      })

      expect(saved.paystackApiUrl).toBe('https://api.paystack.co')
      expect(saved.paystackSecret).toBe('sk_test_new')
      expect(saved.paystackAccessToken).toBe('')
    })
  })

  describe('alert rules — owner scoping', () => {
    it('creates and lists rules for the owner only', async () => {
      const created = await createAlert({
        userId,
        deviceId: null,
        alertType: 'unknown_device',
      })

      expect(created.userId).toBe(userId)
      expect(created.isActive).toBe(true)
      expect(created.triggerCount).toBe(0)
      expect(created.lastTriggered).toBeNull()

      const rules = await getUserAlerts(userId)
      expect(rules).toHaveLength(1)
      expect(rules[0]?.id).toBe(created.id)
    })

    it('hides one user rules from another (F-34)', async () => {
      const otherId = randomUUID()
      const now = new Date().toISOString()
      await db
        .insertInto('users')
        .values({
          id: otherId,
          email: `leak-${otherId}@example.com`,
          password_hash: 'x',
          name: 'Leak',
          role: 'ADMIN',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()

      const mine = await createAlert({ userId, deviceId: null, alertType: 'unknown_device' })
      const theirs = await createAlert({ userId: otherId, deviceId: null, alertType: 'device_offline' })

      const seenByMe = await getUserAlerts(userId)
      expect(seenByMe.map((r) => r.id)).toEqual([mine.id])

      const seenByThem = await getUserAlerts(otherId)
      expect(seenByThem.map((r) => r.id)).toEqual([theirs.id])
    })

    it('updates a rule', async () => {
      const rule = await createAlert({
        userId,
        deviceId: null,
        alertType: 'bandwidth_exceeded',
        threshold: 50,
      })

      const updated = await updateAlert(rule.id, userId, { isActive: false, threshold: 100 })

      expect(updated?.isActive).toBe(false)
      expect(updated?.threshold).toBe(100)
    })

    it('refuses to update a rule owned by someone else', async () => {
      const otherId = randomUUID()
      const now = new Date().toISOString()
      await db
        .insertInto('users')
        .values({
          id: otherId,
          email: `upd-${otherId}@example.com`,
          password_hash: 'x',
          name: 'Upd',
          role: 'ADMIN',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()

      const theirs = await createAlert({ userId: otherId, deviceId: null, alertType: 'device_offline' })

      expect(await updateAlert(theirs.id, userId, { isActive: false })).toBeNull()

      const untouched = await getUserAlerts(otherId)
      expect(untouched[0]?.isActive).toBe(true)
    })

    it('deletes a rule and reports false for one it does not own', async () => {
      const rule = await createAlert({ userId, deviceId: null, alertType: 'device_offline' })

      expect(await deleteAlert(rule.id, userId)).toBe(true)
      expect(await getUserAlerts(userId)).toHaveLength(0)
      expect(await deleteAlert(rule.id, userId)).toBe(false)
    })

    it('does not delete another user rule', async () => {
      const otherId = randomUUID()
      const now = new Date().toISOString()
      await db
        .insertInto('users')
        .values({
          id: otherId,
          email: `del-${otherId}@example.com`,
          password_hash: 'x',
          name: 'Del',
          role: 'ADMIN',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()

      const theirs = await createAlert({ userId: otherId, deviceId: null, alertType: 'device_offline' })

      expect(await deleteAlert(theirs.id, userId)).toBe(false)
      expect(await getUserAlerts(otherId)).toHaveLength(1)
    })
  })

  describe('activity log', () => {
    it('counts and marks unread notifications per owner', async () => {
      const rule = await createAlert({ userId, deviceId: null, alertType: 'unknown_device' })

      await alertRepo.createNotification({
        userId,
        deviceId: null,
        alertId: rule.id,
        title: 'One',
        message: 'first',
        type: 'unknown_device',
        priority: 'high',
      })
      await alertRepo.createNotification({
        userId,
        deviceId: null,
        alertId: rule.id,
        title: 'Two',
        message: 'second',
        type: 'device_offline',
        priority: 'low',
      })

      expect(await countUnread(userId)).toBe(2)

      const all = await getUserNotifications(userId)
      expect(all).toHaveLength(2)

      expect(await markNotificationRead(all[0]!.id, userId)).toBe(true)
      expect(await countUnread(userId)).toBe(1)

      const unread = await getUserNotifications(userId, { unreadOnly: true })
      expect(unread).toHaveLength(1)
      expect(unread[0]!.title).toBe(all[1]!.title)
    })

    it('filters the activity log by type', async () => {
      const rule = await createAlert({ userId, deviceId: null, alertType: 'unknown_device' })

      await alertRepo.createNotification({
        userId,
        deviceId: null,
        alertId: rule.id,
        title: 'A',
        message: 'a',
        type: 'unknown_device',
        priority: 'high',
      })
      await alertRepo.createNotification({
        userId,
        deviceId: null,
        alertId: rule.id,
        title: 'B',
        message: 'b',
        type: 'device_offline',
        priority: 'low',
      })

      const filtered = await getUserNotifications(userId, { type: 'device_offline' })
      expect(filtered).toHaveLength(1)
      expect(filtered[0]!.title).toBe('B')
    })

    it('will not acknowledge a notification owned by someone else', async () => {
      const otherId = randomUUID()
      const now = new Date().toISOString()
      await db
        .insertInto('users')
        .values({
          id: otherId,
          email: `ack-${otherId}@example.com`,
          password_hash: 'x',
          name: 'Ack',
          role: 'ADMIN',
          is_active: 1,
          created_at: now,
          updated_at: now,
        })
        .execute()

      const theirs = await alertRepo.createNotification({
        userId: otherId,
        deviceId: null,
        alertId: null,
        title: 'Theirs',
        message: 'not yours',
        type: 'info',
        priority: 'low',
      })

      expect(await markNotificationRead(theirs.id, userId)).toBe(false)
      expect(await countUnread(otherId)).toBe(1)
      expect(await getUserNotifications(userId)).toHaveLength(0)
    })

    it('falls back to a known type for an unrecognised stored value', async () => {
      await db
        .insertInto('notifications')
        .values({
          id: randomUUID(),
          user_id: userId,
          device_id: null,
          alert_id: null,
          title: 'Odd',
          message: 'written by an older version',
          type: 'something_new',
          priority: 'nonsense',
          is_read: 0,
          read_at: null,
          data: null,
          created_at: new Date().toISOString(),
        })
        .execute()

      const [item] = await getUserNotifications(userId)
      expect(item?.type).toBe('info')
      expect(item?.priority).toBe('medium')
    })
  })
})
