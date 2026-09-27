import { Scanner, DiscoveredDevice } from './types'
import { db } from '@/lib/db/client'
import { decrypt } from '@/lib/utils/encryption'
import { logger } from '@/lib/utils/logger'

interface AsusRouterConfig {
  id: string
  router_ip: string
  port: number
  username: string
  password_encrypted: string
  is_connected: number
  last_check_at: string | null
  last_success_at: string | null
}

interface AsusDevice {
  mac: string
  ip: string
  name: string
  rssi?: number
  online: number
}

interface AsusResponse {
  success: boolean
  devices?: AsusDevice[]
  error?: string
}

let cachedConfig: AsusRouterConfig | null = null
let cachedConfigAt = 0
const CONFIG_TTL = 5 * 60 * 1000

async function getRouterConfig(): Promise<AsusRouterConfig | null> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigAt < CONFIG_TTL) {
    return cachedConfig
  }

  const row = await db
    .selectFrom('router_config')
    .where('router_type', '=', 'asus')
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
    last_check_at: row.last_check_at,
    last_success_at: row.last_success_at,
  }
  cachedConfigAt = now
  return cachedConfig
}

function invalidateConfigCache(): void {
  cachedConfig = null
  cachedConfigAt = 0
}

async function makeRequest<T>(
  config: AsusRouterConfig,
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

export const asusScanner: Scanner = {
  name: 'asus',

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
      // A router that rejects the credentials answers HTTP 200 with
      // `success: false`, so the status code alone is not enough — checking
      // only `response.ok` marked an unusable router as available, and the
      // scanner was then selected and failed on every subsequent scan.
      const body = await makeRequest<{ success: boolean; error?: string }>(
        config,
        '/appGet.cgi?hook=wl_clientlist()',
        'GET'
      )

      if (body?.success !== true) {
        logger.warn(
          { scanner: 'asus', routerError: body?.error ?? 'unsuccessful response' },
          'ASUS router rejected the request'
        )
        this._cachedAvailable = false
        return false
      }

      this._cachedAvailable = true
      invalidateConfigCache()
      return true
    } catch (error) {
      logger.warn({ scanner: 'asus', error: error instanceof Error ? error.message : String(error) }, 'ASUS router unreachable')
      this._cachedAvailable = false
      return false
    }
  },

  async scan(subnet: string): Promise<DiscoveredDevice[]> {
    const config = await getRouterConfig()
    if (!config) {
      throw new Error('No ASUS router configured or not connected')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('ASUS router unavailable')
    }

    try {
      const response = await makeRequest<AsusResponse>(config, '/appGet.cgi?hook=wl_clientlist()', 'GET')

      if (!response.success || !response.devices) {
        throw new Error(response.error || 'Invalid response from ASUS router')
      }

      const devices: DiscoveredDevice[] = response.devices
        .filter((d) => d.online === 1)
        .map((d) => ({
          macAddress: d.mac.toUpperCase(),
          ipAddress: d.ip,
          hostname: d.name || undefined,
          signalStrength: d.rssi !== undefined ? d.rssi : undefined,
        }))

      return devices
    } catch (error) {
      logger.error({ scanner: 'asus', error: error instanceof Error ? error.message : String(error) }, 'ASUS scanner failed')
      throw error
    }
  },
}

export { invalidateConfigCache }