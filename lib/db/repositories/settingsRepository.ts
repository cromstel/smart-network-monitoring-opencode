import { db } from '../client'
import type { DB } from '../schema'
import type { UserSettings, RouterConfig } from '@/lib/types'

export async function findUserSettings(userId: string): Promise<UserSettings | null> {
  const row = await db
    .selectFrom('user_settings')
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()

  return row ? rowToUserSettings(row) : null
}

export async function upsertUserSettings(input: Partial<UserSettings> & { userId: string }): Promise<UserSettings> {
  const now = new Date().toISOString()
  const existing = await findUserSettings(input.userId)

  if (existing) {
    const set: Record<string, string | number | null> = { updated_at: now }
    if ('scanIntervalSeconds' in input) set.scan_interval_seconds = input.scanIntervalSeconds!
    if ('dataRetentionDays' in input) set.data_retention_days = input.dataRetentionDays!
    if ('networkSubnet' in input) set.network_subnet = input.networkSubnet!
    if ('ignoreSubnets' in input) set.ignore_subnets = input.ignoreSubnets ?? null
    if ('notifyNewDevices' in input) set.notify_new_devices = input.notifyNewDevices ? 1 : 0
    if ('notifyDeviceOffline' in input) set.notify_device_offline = input.notifyDeviceOffline ? 1 : 0
    if ('notifyHighBandwidth' in input) set.notify_high_bandwidth = input.notifyHighBandwidth ? 1 : 0
    if ('bandwidthThreshold' in input) set.bandwidth_threshold = input.bandwidthThreshold!
    if ('theme' in input) set.theme = input.theme!

    await db.updateTable('user_settings').set(set).where('user_id', '=', input.userId).execute()
  } else {
    const id = crypto.randomUUID()
    await db.insertInto('user_settings').values({
      id,
      user_id: input.userId,
      scan_interval_seconds: input.scanIntervalSeconds ?? 30,
      data_retention_days: input.dataRetentionDays ?? 30,
      network_subnet: input.networkSubnet ?? '192.168.1.0/24',
      ignore_subnets: input.ignoreSubnets ?? null,
      notify_new_devices: input.notifyNewDevices ? 1 : 1,
      notify_device_offline: input.notifyDeviceOffline ? 1 : 1,
      notify_high_bandwidth: input.notifyHighBandwidth ? 1 : 0,
      bandwidth_threshold: input.bandwidthThreshold ?? 100,
      theme: input.theme ?? 'dark',
      created_at: now,
      updated_at: now,
    }).execute()
  }

  const settings = await findUserSettings(input.userId)
  if (!settings) throw new Error('Failed to create user settings')
  return settings
}

export async function findRouterConfig(userId?: string): Promise<RouterConfig | null> {
  let query = db.selectFrom('router_config').where('is_connected', '=', 1)
  if (userId) {
    query = query.where('id', '=', userId)
  }
  const row = await query.selectAll().executeTakeFirst()
  return row ? rowToRouterConfig(row) : null
}

export async function upsertRouterConfig(input: Partial<RouterConfig> & { id?: string }): Promise<RouterConfig> {
  const now = new Date().toISOString()

  if (input.id) {
    const set: Record<string, string | number | null> = { updated_at: now }
    if ('routerType' in input) set.router_type = input.routerType!
    if ('routerName' in input) set.router_name = input.routerName ?? null
    if ('routerIp' in input) set.router_ip = input.routerIp!
    if ('port' in input) set.port = input.port!
    if ('username' in input) set.username = input.username!
    if ('passwordEncrypted' in input) set.password_encrypted = input.passwordEncrypted!
    if ('macAddress' in input) set.mac_address = input.macAddress ?? null
    if ('modelNumber' in input) set.model_number = input.modelNumber ?? null
    if ('firmwareVersion' in input) set.firmware_version = input.firmwareVersion ?? null
    if ('isConnected' in input) set.is_connected = input.isConnected ? 1 : 0
    if ('lastCheckAt' in input) set.last_check_at = input.lastCheckAt?.toISOString() ?? null
    if ('lastSuccessAt' in input) set.last_success_at = input.lastSuccessAt?.toISOString() ?? null

    await db.updateTable('router_config').set(set).where('id', '=', input.id).execute()
  } else {
    const id = crypto.randomUUID()
    await db.insertInto('router_config').values({
      id,
      router_type: input.routerType!,
      router_name: input.routerName ?? null,
      router_ip: input.routerIp!,
      port: input.port ?? 80,
      username: input.username!,
      password_encrypted: input.passwordEncrypted!,
      mac_address: input.macAddress ?? null,
      model_number: input.modelNumber ?? null,
      firmware_version: input.firmwareVersion ?? null,
      is_connected: input.isConnected ? 1 : 0,
      last_check_at: input.lastCheckAt?.toISOString() ?? null,
      last_success_at: input.lastSuccessAt?.toISOString() ?? null,
      created_at: now,
      updated_at: now,
    }).execute()
    input.id = id
  }

  const router = await findRouterConfig()
  if (!router) throw new Error('Failed to create router config')
  return router
}

export async function disconnectRouter(): Promise<void> {
  await db.updateTable('router_config')
    .set({ is_connected: 0, updated_at: new Date().toISOString() })
    .where('is_connected', '=', 1)
    .execute()
}

export async function updateRouterLastCheck(id: string, success: boolean): Promise<void> {
  const now = new Date().toISOString()
  const set: Record<string, string | number | null> = { last_check_at: now, updated_at: now }
  if (success) {
    set.last_success_at = now
    set.is_connected = 1
  } else {
    set.is_connected = 0
  }
  await db.updateTable('router_config').set(set).where('id', '=', id).execute()
}

function rowToUserSettings(row: { id: string; user_id: string; scan_interval_seconds: number; data_retention_days: number; network_subnet: string; ignore_subnets: string | null; notify_new_devices: number; notify_device_offline: number; notify_high_bandwidth: number; bandwidth_threshold: number; theme: string; created_at: string; updated_at: string }): UserSettings {
  return {
    id: row.id,
    userId: row.user_id,
    scanIntervalSeconds: row.scan_interval_seconds,
    dataRetentionDays: row.data_retention_days,
    networkSubnet: row.network_subnet,
    ignoreSubnets: row.ignore_subnets,
    notifyNewDevices: row.notify_new_devices === 1,
    notifyDeviceOffline: row.notify_device_offline === 1,
    notifyHighBandwidth: row.notify_high_bandwidth === 1,
    bandwidthThreshold: row.bandwidth_threshold,
    theme: row.theme as 'dark' | 'light',
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function rowToRouterConfig(row: { id: string; router_type: string; router_name: string | null; router_ip: string; port: number; username: string; password_encrypted: string; mac_address: string | null; model_number: string | null; firmware_version: string | null; is_connected: number; last_check_at: string | null; last_success_at: string | null; created_at: string; updated_at: string }): RouterConfig {
  return {
    id: row.id,
    routerType: row.router_type as 'asus' | 'tplink' | 'netgear' | 'generic',
    routerName: row.router_name,
    routerIp: row.router_ip,
    port: row.port,
    username: row.username,
    passwordEncrypted: row.password_encrypted,
    macAddress: row.mac_address,
    modelNumber: row.model_number,
    firmwareVersion: row.firmware_version,
    isConnected: row.is_connected === 1,
    lastCheckAt: row.last_check_at ? new Date(row.last_check_at) : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}