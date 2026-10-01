import { db } from '@/lib/db/client'
import { createMigrator } from '@/lib/db/migrator'
import { logger } from '@/lib/utils/logger'
import type { Device } from '@/lib/types'
import { randomUUID } from 'node:crypto'
import { sql } from 'kysely'

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

describe('Alert Engine Cross-User Leak Prevention', () => {
  let userA: { id: string; email: string; name: string }
  let userB: { id: string; email: string; name: string }
  let deviceA: Device
  let deviceB: Device
  let alertRuleA: { id: string; user_id: string; device_id: string | null; alert_type: string; is_active: number }
  let alertRuleB: { id: string; user_id: string; device_id: string | null; alert_type: string; is_active: number }

  beforeAll(async () => {
    const migrate = await createMigrator(db).migrateToLatest()
    if (migrate.error) throw migrate.error
  })

beforeEach(async () => {
    // Children before parents, every time. `sessions.user_id` and
    // `user_settings.user_id` both reference `users`, and `notifications` and
    // `device_alerts` reference both users and devices. Deleting `users` before
    // `sessions` only worked while no session row happened to exist. On SQLite
    // each suite gets a private :memory: database, so that held by luck; against
    // MariaDB or MySQL, where the run shares one schema, a row left behind by
    // an earlier suite would make this throw instead of clearing.
    for (const table of [
      'notifications',
      'device_alerts',
      'sessions',
      'user_settings',
      'connection_logs',
      'bandwidth_hourly',
      'bandwidth_metrics',
      'devices',
      'device_categories',
      'users',
    ] as const) {
      await db.deleteFrom(table).execute()
    }

    userA = { id: randomUUID(), email: 'user-a@example.com', name: 'User A' }
    userB = { id: randomUUID(), email: 'user-b@example.com', name: 'User B' }

    await db.insertInto('users').values([
      { id: userA.id, email: userA.email, password_hash: 'hash', name: userA.name, role: 'ADMIN', is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: userB.id, email: userB.email, password_hash: 'hash', name: userB.name, role: 'ADMIN', is_active: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]).execute()

    const deviceAId = randomUUID()
    const deviceBId = randomUUID()

    deviceA = {
      id: deviceAId,
      macAddress: 'AA:BB:CC:DD:EE:01',
      ipAddress: '192.168.1.10',
      hostname: 'device-a',
      deviceName: 'Device A',
      deviceType: 'laptop',
      manufacturer: 'Test',
      signalStrength: -50,
      status: 'online',
      isBlocked: false,
      isIgnored: false,
      totalConnectionTimeSeconds: 0,
      categoryId: null,
      firstSeen: new Date(),
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    deviceB = {
      id: deviceBId,
      macAddress: 'AA:BB:CC:DD:EE:02',
      ipAddress: '192.168.1.11',
      hostname: 'device-b',
      deviceName: 'Device B',
      deviceType: 'phone',
      manufacturer: 'Test',
      signalStrength: -60,
      status: 'online',
      isBlocked: false,
      isIgnored: false,
      totalConnectionTimeSeconds: 0,
      categoryId: null,
      firstSeen: new Date(),
      lastSeen: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const now = new Date().toISOString()
    await db.insertInto('devices').values([
      {
        id: deviceA.id,
        mac_address: deviceA.macAddress,
        ip_address: deviceA.ipAddress,
        hostname: deviceA.hostname,
        device_name: deviceA.deviceName,
        device_type: deviceA.deviceType,
        manufacturer: deviceA.manufacturer,
        signal_strength: deviceA.signalStrength,
        status: deviceA.status,
        is_blocked: 0,
        is_ignored: 0,
        total_connection_time: '0',
        category_id: deviceA.categoryId,
        first_seen: deviceA.firstSeen.toISOString(),
        last_seen: deviceA.lastSeen.toISOString(),
        created_at: deviceA.createdAt.toISOString(),
        updated_at: deviceA.updatedAt.toISOString(),
      },
      {
        id: deviceB.id,
        mac_address: deviceB.macAddress,
        ip_address: deviceB.ipAddress,
        hostname: deviceB.hostname,
        device_name: deviceB.deviceName,
        device_type: deviceB.deviceType,
        manufacturer: deviceB.manufacturer,
        signal_strength: deviceB.signalStrength,
        status: deviceB.status,
        is_blocked: 0,
        is_ignored: 0,
        total_connection_time: '0',
        category_id: deviceB.categoryId,
        first_seen: deviceB.firstSeen.toISOString(),
        last_seen: deviceB.lastSeen.toISOString(),
        created_at: deviceB.createdAt.toISOString(),
        updated_at: deviceB.updatedAt.toISOString(),
      },
    ]).execute()

    alertRuleA = { id: randomUUID(), user_id: userA.id, device_id: deviceA.id, alert_type: 'device_offline', is_active: 1 }
    alertRuleB = { id: randomUUID(), user_id: userB.id, device_id: deviceB.id, alert_type: 'device_offline', is_active: 1 }

    await db.insertInto('device_alerts').values([
      { ...alertRuleA, threshold: null, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { ...alertRuleB, threshold: null, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]).execute()
  })

  afterAll(async () => {
    await db.destroy()
  })

  describe('Alert queries must be scoped by owner (user_id)', () => {
    it('User A can only see their own alerts', async () => {
      const alertsForA = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .selectAll()
        .execute()

      expect(alertsForA).toHaveLength(1)
      expect(alertsForA[0].id).toBe(alertRuleA.id)
      expect(alertsForA[0].user_id).toBe(userA.id)
    })

    it('User B can only see their own alerts', async () => {
      const alertsForB = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userB.id)
        .selectAll()
        .execute()

      expect(alertsForB).toHaveLength(1)
      expect(alertsForB[0].id).toBe(alertRuleB.id)
      expect(alertsForB[0].user_id).toBe(userB.id)
    })

    it('User A cannot see User B alerts', async () => {
      const alertsForA = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .selectAll()
        .execute()

      const userBAlertIds = alertsForA.map((a) => a.id)
      expect(userBAlertIds).not.toContain(alertRuleB.id)
    })

    it('User B cannot see User A alerts', async () => {
      const alertsForB = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userB.id)
        .selectAll()
        .execute()

      const userAAlertIds = alertsForB.map((a) => a.id)
      expect(userAAlertIds).not.toContain(alertRuleA.id)
    })
  })

  describe('Notification queries must be scoped by owner', () => {
    beforeEach(async () => {
      await db.insertInto('notifications').values([
        { id: randomUUID(), user_id: userA.id, device_id: deviceA.id, alert_id: alertRuleA.id, title: 'A Alert', message: 'Device A offline', type: 'device_offline', priority: 'high', is_read: 0, read_at: null, data: null, created_at: new Date().toISOString() },
        { id: randomUUID(), user_id: userB.id, device_id: deviceB.id, alert_id: alertRuleB.id, title: 'B Alert', message: 'Device B offline', type: 'device_offline', priority: 'high', is_read: 0, read_at: null, data: null, created_at: new Date().toISOString() },
      ]).execute()
    })

    it('User A only receives their own notifications', async () => {
      const notificationsA = await db
        .selectFrom('notifications')
        .where('user_id', '=', userA.id)
        .selectAll()
        .execute()

      expect(notificationsA).toHaveLength(1)
      expect(notificationsA[0].user_id).toBe(userA.id)
      expect(notificationsA[0].title).toBe('A Alert')
    })

    it('User B only receives their own notifications', async () => {
      const notificationsB = await db
        .selectFrom('notifications')
        .where('user_id', '=', userB.id)
        .selectAll()
        .execute()

      expect(notificationsB).toHaveLength(1)
      expect(notificationsB[0].user_id).toBe(userB.id)
      expect(notificationsB[0].title).toBe('B Alert')
    })

    it('No cross-user notification leakage', async () => {
      const notificationsA = await db
        .selectFrom('notifications')
        .where('user_id', '=', userA.id)
        .selectAll()
        .execute()

      const notificationsB = await db
        .selectFrom('notifications')
        .where('user_id', '=', userB.id)
        .selectAll()
        .execute()

      const aUserIds = notificationsA.map((n) => n.user_id)
      const bUserIds = notificationsB.map((n) => n.user_id)

      expect(aUserIds).not.toContain(userB.id)
      expect(bUserIds).not.toContain(userA.id)
    })
  })

  describe('Alert rule evaluation must be owner-scoped', () => {
    it('Device offline alert only triggers for owner', async () => {
      await db.updateTable('devices').set({ status: 'offline', updated_at: new Date().toISOString() }).where('id', '=', deviceA.id).execute()

      const alertsForA = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .where('device_id', '=', deviceA.id)
        .where('alert_type', '=', 'device_offline')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      const alertsForB = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userB.id)
        .where('device_id', '=', deviceA.id)
        .where('alert_type', '=', 'device_offline')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      expect(alertsForA).toHaveLength(1)
      expect(alertsForB).toHaveLength(0)
    })

    it('Unknown device alert only triggers for owner', async () => {
      const unknownAlertA = { id: randomUUID(), user_id: userA.id, device_id: null, alert_type: 'unknown_device', threshold: null, is_active: 1, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      const unknownAlertB = { id: randomUUID(), user_id: userB.id, device_id: null, alert_type: 'unknown_device', threshold: null, is_active: 1, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }

      await db.insertInto('device_alerts').values([unknownAlertA, unknownAlertB]).execute()

      const unknownAlertsForA = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .where('alert_type', '=', 'unknown_device')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      const unknownAlertsForB = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userB.id)
        .where('alert_type', '=', 'unknown_device')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      expect(unknownAlertsForA).toHaveLength(1)
      expect(unknownAlertsForB).toHaveLength(1)
      expect(unknownAlertsForA[0].id).toBe(unknownAlertA.id)
      expect(unknownAlertsForB[0].id).toBe(unknownAlertB.id)
    })
  })

  describe('Global alert rules (device_id = null) are still owner-scoped', () => {
    beforeEach(async () => {
      const globalAlertA = { id: randomUUID(), user_id: userA.id, device_id: null, alert_type: 'unknown_device', threshold: null, is_active: 1, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      const globalAlertB = { id: randomUUID(), user_id: userB.id, device_id: null, alert_type: 'unknown_device', threshold: null, is_active: 1, last_triggered: null, trigger_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }

      await db.insertInto('device_alerts').values([globalAlertA, globalAlertB]).execute()
    })

    it('User A sees only their global alerts', async () => {
      const globalAlertsA = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .where('device_id', 'is', null)
        .where('alert_type', '=', 'unknown_device')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      expect(globalAlertsA).toHaveLength(1)
      expect(globalAlertsA[0].user_id).toBe(userA.id)
    })

    it('User B does not see User A global alerts', async () => {
      const globalAlertsB = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userB.id)
        .where('device_id', 'is', null)
        .where('alert_type', '=', 'unknown_device')
        .where('is_active', '=', 1)
        .selectAll()
        .execute()

      const aAlertIds = globalAlertsB.map((a) => a.id)
      const userAGlobalAlert = await db
        .selectFrom('device_alerts')
        .where('user_id', '=', userA.id)
        .where('device_id', 'is', null)
        .where('alert_type', '=', 'unknown_device')
        .where('is_active', '=', 1)
        .select('id')
        .executeTakeFirst()

      expect(aAlertIds).not.toContain(userAGlobalAlert?.id)
    })
  })

  describe('Activity log queries must be owner-scoped', () => {
    beforeEach(async () => {
      await db.insertInto('notifications').values([
        { id: randomUUID(), user_id: userA.id, device_id: deviceA.id, alert_id: alertRuleA.id, title: 'A Alert 1', message: 'Device A offline', type: 'device_offline', priority: 'high', is_read: 0, read_at: null, data: null, created_at: new Date().toISOString() },
        { id: randomUUID(), user_id: userA.id, device_id: deviceA.id, alert_id: alertRuleA.id, title: 'A Alert 2', message: 'Device A back online', type: 'device_online', priority: 'medium', is_read: 0, read_at: null, data: null, created_at: new Date().toISOString() },
        { id: randomUUID(), user_id: userB.id, device_id: deviceB.id, alert_id: alertRuleB.id, title: 'B Alert 1', message: 'Device B offline', type: 'device_offline', priority: 'high', is_read: 0, read_at: null, data: null, created_at: new Date().toISOString() },
      ]).execute()
    })

    it('User A activity log only contains their events', async () => {
      const activityA = await db
        .selectFrom('notifications')
        .where('user_id', '=', userA.id)
        .orderBy('created_at', 'desc')
        .selectAll()
        .execute()

      expect(activityA).toHaveLength(2)
      activityA.forEach((event) => {
        expect(event.user_id).toBe(userA.id)
      })
    })

    it('User B activity log only contains their events', async () => {
      const activityB = await db
        .selectFrom('notifications')
        .where('user_id', '=', userB.id)
        .orderBy('created_at', 'desc')
        .selectAll()
        .execute()

      expect(activityB).toHaveLength(1)
      activityB.forEach((event) => {
        expect(event.user_id).toBe(userB.id)
      })
    })

    it('Activity log filtering by type works per user', async () => {
      const offlineA = await db
        .selectFrom('notifications')
        .where('user_id', '=', userA.id)
        .where('type', '=', 'device_offline')
        .selectAll()
        .execute()

      const onlineA = await db
        .selectFrom('notifications')
        .where('user_id', '=', userA.id)
        .where('type', '=', 'device_online')
        .selectAll()
        .execute()

      expect(offlineA).toHaveLength(1)
      expect(onlineA).toHaveLength(1)
      expect(offlineA[0].title).toBe('A Alert 1')
      expect(onlineA[0].title).toBe('A Alert 2')
    })
  })

  describe('Database constraints enforce ownership', () => {
// Without this the two tests below can only report "function did not
    // throw", which is indistinguishable from the constraint being absent and
    // from the constraint existing but not being enforced on this connection.
    // Enforcement is per connection and is the thing most likely to be quietly
    // lost, so assert it rather than inferring it. The switch is spelled
    // differently per dialect, hence the branch.
    it('foreign key enforcement is actually active on this connection', async () => {
      if (process.env.DB_CLIENT === 'mysql') {
        const result = await sql<{ foreign_key_checks: number }>`SELECT @@foreign_key_checks AS foreign_key_checks`.execute(db)
        expect(Number(result.rows[0]?.foreign_key_checks)).toBe(1)
      } else {
        const result = await sql<{ foreign_keys: number }>`PRAGMA foreign_keys`.execute(db)
        expect(Number(result.rows[0]?.foreign_keys)).toBe(1)
      }
    })
    it('device_alerts has foreign key to users', async () => {
      const fakeUserId = randomUUID()
      await expect(
        db.insertInto('device_alerts').values({
          id: randomUUID(),
          user_id: fakeUserId,
          device_id: deviceA.id,
          alert_type: 'device_offline',
          is_active: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).execute()
      ).rejects.toThrow()
    })

    it('notifications has foreign key to users', async () => {
      const fakeUserId = randomUUID()
      await expect(
        db.insertInto('notifications').values({
          id: randomUUID(),
          user_id: fakeUserId,
          device_id: deviceA.id,
          alert_id: alertRuleA.id,
          title: 'Test',
          message: 'Test',
          type: 'device_offline',
          priority: 'high',
          is_read: 0,
          created_at: new Date().toISOString(),
        }).execute()
      ).rejects.toThrow()
    })
  })
})
