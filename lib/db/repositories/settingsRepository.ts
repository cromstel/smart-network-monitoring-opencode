import { randomUUID } from 'node:crypto'
import { db } from '../client'
import type { UserSettings, RouterConfig } from '@/lib/types'

/**
 * User settings and router configuration.
 *
 * SQLite is opened with `defaultSafeIntegers(true)`, so every INTEGER column
 * arrives as a `bigint`. These mappers normalise with `Number(...)`, matching
 * `mappers.ts`. Without that conversion a setting reads back as `60n` and
 * `row.notify_new_devices === 1` is false, because `1n !== 1` — every toggle
 * would silently render off.
 */

type Int = number | bigint

function toInt(value: Int): number {
  return Number(value)
}

function toBool(value: Int): boolean {
  return Number(value) === 1
}

const THEMES = ['dark', 'light'] as const
const ROUTER_TYPES = ['asus', 'tplink', 'netgear', 'generic'] as const

function toTheme(value: string): UserSettings['theme'] {
  return (THEMES as readonly string[]).includes(value) ? (value as UserSettings['theme']) : 'dark'
}

function toRouterType(value: string): RouterConfig['routerType'] {
  return (ROUTER_TYPES as readonly string[]).includes(value)
    ? (value as RouterConfig['routerType'])
    : 'generic'
}

interface SettingsRow {
  id: string
  user_id: string
  scan_interval_seconds: Int
  data_retention_days: Int
  network_subnet: string
  ignore_subnets: string | null
  notify_new_devices: Int
  notify_device_offline: Int
  notify_high_bandwidth: Int
  bandwidth_threshold: number | Int
  theme: string
  created_at: string
  updated_at: string
}

interface RouterRow {
  id: string
  router_type: string
  router_name: string | null
  router_ip: string
  port: Int
  username: string
  password_encrypted: string
  mac_address: string | null
  model_number: string | null
  firmware_version: string | null
  is_connected: Int
  last_check_at: string | null
  last_success_at: string | null
  created_at: string
  updated_at: string
}

function rowToUserSettings(row: SettingsRow): UserSettings {
  return {
    id: row.id,
    userId: row.user_id,
    scanIntervalSeconds: toInt(row.scan_interval_seconds),
    dataRetentionDays: toInt(row.data_retention_days),
    networkSubnet: row.network_subnet,
    ignoreSubnets: row.ignore_subnets,
    notifyNewDevices: toBool(row.notify_new_devices),
    notifyDeviceOffline: toBool(row.notify_device_offline),
    notifyHighBandwidth: toBool(row.notify_high_bandwidth),
    bandwidthThreshold: toInt(row.bandwidth_threshold),
    theme: toTheme(row.theme),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

function rowToRouterConfig(row: RouterRow): RouterConfig {
  return {
    id: row.id,
    routerType: toRouterType(row.router_type),
    routerName: row.router_name,
    routerIp: row.router_ip,
    port: toInt(row.port),
    username: row.username,
    passwordEncrypted: row.password_encrypted,
    macAddress: row.mac_address,
    modelNumber: row.model_number,
    firmwareVersion: row.firmware_version,
    isConnected: toBool(row.is_connected),
    lastCheckAt: row.last_check_at ? new Date(row.last_check_at) : null,
    lastSuccessAt: row.last_success_at ? new Date(row.last_success_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  }
}

const DEFAULTS = {
  scanIntervalSeconds: 30,
  dataRetentionDays: 30,
  networkSubnet: '192.168.1.0/24',
  bandwidthThreshold: 100,
  theme: 'dark' as const,
}

export async function findUserSettings(userId: string): Promise<UserSettings | null> {
  const row = await db
    .selectFrom('user_settings')
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()

  return row ? rowToUserSettings(row as SettingsRow) : null
}

export async function upsertUserSettings(
  input: Partial<UserSettings> & { userId: string }
): Promise<UserSettings> {
  const now = new Date().toISOString()
  const existing = await findUserSettings(input.userId)

  if (existing) {
    const set: Record<string, string | number | null> = { updated_at: now }
    if ('scanIntervalSeconds' in input && input.scanIntervalSeconds != null)
      set.scan_interval_seconds = input.scanIntervalSeconds
    if ('dataRetentionDays' in input && input.dataRetentionDays != null)
      set.data_retention_days = input.dataRetentionDays
    if ('networkSubnet' in input && input.networkSubnet != null)
      set.network_subnet = input.networkSubnet
    if ('ignoreSubnets' in input) set.ignore_subnets = input.ignoreSubnets ?? null
    if ('notifyNewDevices' in input && input.notifyNewDevices != null)
      set.notify_new_devices = input.notifyNewDevices ? 1 : 0
    if ('notifyDeviceOffline' in input && input.notifyDeviceOffline != null)
      set.notify_device_offline = input.notifyDeviceOffline ? 1 : 0
    if ('notifyHighBandwidth' in input && input.notifyHighBandwidth != null)
      set.notify_high_bandwidth = input.notifyHighBandwidth ? 1 : 0
    if ('bandwidthThreshold' in input && input.bandwidthThreshold != null)
      set.bandwidth_threshold = input.bandwidthThreshold
    if ('theme' in input && input.theme != null) set.theme = input.theme

    await db.updateTable('user_settings').set(set).where('user_id', '=', input.userId).execute()
  } else {
    await db
      .insertInto('user_settings')
      .values({
        id: randomUUID(),
        user_id: input.userId,
        scan_interval_seconds: input.scanIntervalSeconds ?? DEFAULTS.scanIntervalSeconds,
        data_retention_days: input.dataRetentionDays ?? DEFAULTS.dataRetentionDays,
        network_subnet: input.networkSubnet ?? DEFAULTS.networkSubnet,
        ignore_subnets: input.ignoreSubnets ?? null,
        notify_new_devices: (input.notifyNewDevices ?? true) ? 1 : 0,
        notify_device_offline: (input.notifyDeviceOffline ?? true) ? 1 : 0,
        notify_high_bandwidth: (input.notifyHighBandwidth ?? false) ? 1 : 0,
        bandwidth_threshold: input.bandwidthThreshold ?? DEFAULTS.bandwidthThreshold,
        theme: input.theme ?? DEFAULTS.theme,
        created_at: now,
        updated_at: now,
      })
      .execute()
  }

  const settings = await findUserSettings(input.userId)
  if (!settings) throw new Error('Failed to write user settings')
  return settings
}

// ---------------------------------------------------------------------------
// Router configuration
// ---------------------------------------------------------------------------

export async function findRouterConfig(id?: string): Promise<RouterConfig | null> {
  let query = db.selectFrom('router_config')
  if (id) {
    query = query.where('id', '=', id)
  } else {
    query = query.where('is_connected', '=', 1)
  }

  const row = await query.selectAll().executeTakeFirst()
  return row ? rowToRouterConfig(row as RouterRow) : null
}

export async function upsertRouterConfig(
  input: Partial<RouterConfig> & { id?: string }
): Promise<RouterConfig> {
  const now = new Date().toISOString()

  if (input.id) {
    const set: Record<string, string | number | null> = { updated_at: now }
    if ('routerType' in input && input.routerType) set.router_type = input.routerType
    if ('routerName' in input) set.router_name = input.routerName ?? null
    if ('routerIp' in input && input.routerIp) set.router_ip = input.routerIp
    if ('port' in input && input.port != null) set.port = input.port
    if ('username' in input && input.username) set.username = input.username
    if ('passwordEncrypted' in input && input.passwordEncrypted)
      set.password_encrypted = input.passwordEncrypted
    if ('macAddress' in input) set.mac_address = input.macAddress ?? null
    if ('modelNumber' in input) set.model_number = input.modelNumber ?? null
    if ('firmwareVersion' in input) set.firmware_version = input.firmwareVersion ?? null
    if ('isConnected' in input && input.isConnected != null)
      set.is_connected = input.isConnected ? 1 : 0
    if ('lastCheckAt' in input)
      set.last_check_at = input.lastCheckAt?.toISOString() ?? null
    if ('lastSuccessAt' in input)
      set.last_success_at = input.lastSuccessAt?.toISOString() ?? null

    await db.updateTable('router_config').set(set).where('id', '=', input.id).execute()

    const updated = await findRouterConfig(input.id)
    if (!updated) throw new Error('Router config not found after update')
    return updated
  }

  const id = randomUUID()
  await db
    .insertInto('router_config')
    .values({
      id,
      router_type: input.routerType ?? 'generic',
      router_name: input.routerName ?? null,
      router_ip: input.routerIp ?? '0.0.0.0',
      port: input.port ?? 80,
      username: input.username ?? 'admin',
      password_encrypted: input.passwordEncrypted ?? '',
      mac_address: input.macAddress ?? null,
      model_number: input.modelNumber ?? null,
      firmware_version: input.firmwareVersion ?? null,
      is_connected: input.isConnected ? 1 : 0,
      last_check_at: input.lastCheckAt?.toISOString() ?? null,
      last_success_at: input.lastSuccessAt?.toISOString() ?? null,
      created_at: now,
      updated_at: now,
    })
    .execute()

  const created = await findRouterConfig(id)
  if (!created) throw new Error('Failed to write router config')
  return created
}

export async function updateRouterReachability(
  id: string,
  reachable: boolean,
  meta?: { macAddress?: string | null; modelNumber?: string | null; firmwareVersion?: string | null }
): Promise<void> {
  const now = new Date().toISOString()
  const set: Record<string, string | number | null> = {
    last_check_at: now,
    is_connected: reachable ? 1 : 0,
    updated_at: now,
  }
  if (reachable) set.last_success_at = now
  if (meta?.macAddress) set.mac_address = meta.macAddress
  if (meta?.modelNumber) set.model_number = meta.modelNumber
  if (meta?.firmwareVersion) set.firmware_version = meta.firmwareVersion

  await db.updateTable('router_config').set(set).where('id', '=', id).execute()
}
