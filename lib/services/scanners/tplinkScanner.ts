import { Scanner, DiscoveredDevice } from './types'
import { db } from '@/lib/db/client'
import { decrypt } from '@/lib/utils/encryption'
import { logger } from '@/lib/utils/logger'

interface TplinkRouterConfig {
  id: string
  router_ip: string
  port: number
  username: string
  password_encrypted: string
  is_connected: number
}

let cachedConfig: TplinkRouterConfig | null = null
let cachedConfigAt = 0
const CONFIG_TTL = 5 * 60 * 1000

async function getRouterConfig(): Promise<TplinkRouterConfig | null> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigAt < CONFIG_TTL) {
    return cachedConfig
  }

  const row = await db
    .selectFrom('router_config')
    .where('router_type', '=', 'tplink')
    .where('is_connected', '=', 1)
    .selectAll()
    .executeTakeFirst()

  if (!row) {
    cachedConfig = null
    return null
  }

  cachedConfig = {
    id: row.id,
    router_ip: row.router_ip,
    port: row.port,
    username: row.username,
    password_encrypted: row.password_encrypted,
    is_connected: row.is_connected,
  }
  cachedConfigAt = now
  return cachedConfig
}

function invalidateConfigCache(): void {
  cachedConfig = null
  cachedConfigAt = 0
}

async function makeRequest<T>(
  config: TplinkRouterConfig,
  endpoint: string,
  method: 'GET' | 'POST' = 'GET',
  body?: Record<string, unknown>
): Promise<T> {
  const url = `http://${config.router_ip}:${config.port}${endpoint}`
  const password = decrypt(config.password_encrypted)

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    Authorization: `Basic ${Buffer.from(`${config.username}:${password}`, 'utf8').toString('base64')}`,
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body ? new URLSearchParams(body as Record<string, string>).toString() : undefined,
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('Request timeout')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

interface TplinkDevice {
  mac: string
  ip: string
  name?: string
  online?: number
}

interface TplinkResponse {
  success: boolean
  devices?: TplinkDevice[]
  error?: string
}

export const tplinkScanner: Scanner = {
  name: 'tplink',

  _cachedAvailable: undefined as boolean | undefined,

  async isAvailable(): Promise<boolean> {
    const cached = this._cachedAvailable
    if (cached !== null && cached !== undefined) return cached

    const config = await getRouterConfig()
    if (!config) {
      this._cachedAvailable = false
      return false
    }

    try {
      const body = await makeRequest<{ success: boolean; error?: string }>(
        config,
        '/userdata/DevicelistRpm.js',
        'GET'
      )

      if (body?.success !== true) {
        logger.warn(
          { scanner: 'tplink', routerError: body?.error ?? 'unsuccessful response' },
          'TP-Link router rejected the request'
        )
        this._cachedAvailable = false
        return false
      }

      this._cachedAvailable = true
      invalidateConfigCache()
      return true
    } catch (error) {
      logger.warn({ scanner: 'tplink', error: error instanceof Error ? error.message : String(error) }, 'TP-Link router unreachable')
      this._cachedAvailable = false
      return false
    }
  },

  async scan(subnet: string): Promise<DiscoveredDevice[]> {
    const config = await getRouterConfig()
    if (!config) {
      throw new Error('No TP-Link router configured or not connected')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('TP-Link router unavailable')
    }

    try {
      const response = await makeRequest<TplinkResponse>(
        config,
        '/userdata/DevicelistRpm.js',
        'GET'
      )

      if (!response.success || !response.devices) {
        throw new Error(response.error || 'Invalid response from TP-Link router')
      }

      const devices: DiscoveredDevice[] = response.devices
        .filter((d) => d.online === 1 || d.online === undefined)
        .map((d) => ({
          macAddress: d.mac.toUpperCase(),
          ipAddress: d.ip,
          ipv6Address: null,
          hostname: d.name || undefined,
          signalStrength: undefined,
        }))

      return devices
    } catch (error) {
      logger.error({ scanner: 'tplink', error: error instanceof Error ? error.message : String(error) }, 'TP-Link scanner failed')
      throw error
    }
  },
}

export { invalidateConfigCache }
