import { Scanner, DiscoveredDevice } from './types'
import { db } from '@/lib/db/client'
import { decrypt } from '@/lib/utils/encryption'
import { logger } from '@/lib/utils/logger'

interface NetgearRouterConfig {
  id: string
  router_ip: string
  port: number
  username: string
  password_encrypted: string
  is_connected: number
}

let cachedConfig: NetgearRouterConfig | null = null
let cachedConfigAt = 0
const CONFIG_TTL = 5 * 60 * 1000

async function getRouterConfig(): Promise<NetgearRouterConfig | null> {
  const now = Date.now()
  if (cachedConfig && now - cachedConfigAt < CONFIG_TTL) {
    return cachedConfig
  }

  const row = await db
    .selectFrom('router_config')
    .where('router_type', '=', 'netgear')
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
  config: NetgearRouterConfig,
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

interface NetgearDevice {
  macaddr: string
  ipaddr: string
  devicename?: string
}

export interface NetgearDhcpLease {
  mac: string
  ip: string
  hostname?: string
  expires?: string
}

interface NetgearResponse {
  result: string
  device_list?: NetgearDevice[]
  error?: string
}

interface NetgearDhcpResponse {
  result: string
  leases?: NetgearDhcpLease[]
  error?: string
}

export const netgearScanner: Scanner = {
  name: 'netgear',

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
      const body = await makeRequest<{ result: string; error?: string }>(
        config,
        '/RPM_DevInfo.htm',
        'GET'
      )

      if (body?.result !== 'success') {
        logger.warn(
          { scanner: 'netgear', routerError: body?.error ?? 'unsuccessful response' },
          'Netgear router rejected the request'
        )
        this._cachedAvailable = false
        return false
      }

      this._cachedAvailable = true
      invalidateConfigCache()
      return true
    } catch (error) {
      logger.warn({ scanner: 'netgear', error: error instanceof Error ? error.message : String(error) }, 'Netgear router unreachable')
      this._cachedAvailable = false
      return false
    }
  },

  async scan(subnet: string): Promise<{ devices: DiscoveredDevice[]; dhcpLeases: NetgearDhcpLease[] }> {
    const config = await getRouterConfig()
    if (!config) {
      throw new Error('No Netgear router configured or not connected')
    }

    const available = await this.isAvailable()
    if (!available) {
      throw new Error('Netgear router unavailable')
    }

    try {
      const [deviceResponse, dhcpResponse] = await Promise.allSettled([
        makeRequest<NetgearResponse>(config, '/RPM_DevInfo.htm', 'GET'),
        makeRequest<NetgearDhcpResponse>(config, '/DHCPList.htm', 'GET'),
      ])

      if (deviceResponse.status !== 'fulfilled' || deviceResponse.value.result !== 'success' || !deviceResponse.value.device_list) {
        throw new Error(deviceResponse.status === 'fulfilled' ? deviceResponse.value.error || 'Invalid response from Netgear router' : 'Failed to fetch device list')
      }

      const devices: DiscoveredDevice[] = deviceResponse.value.device_list.map((d) => ({
        macAddress: d.macaddr.toUpperCase(),
        ipAddress: d.ipaddr,
        ipv6Address: null,
        hostname: d.devicename || undefined,
        signalStrength: undefined,
      }))

      const dhcpLeases: NetgearDhcpLease[] = dhcpResponse.status === 'fulfilled' && dhcpResponse.value.result === 'success' && dhcpResponse.value.leases
        ? dhcpResponse.value.leases
        : []

      return { devices, dhcpLeases }
    } catch (error) {
      logger.error({ scanner: 'netgear', error: error instanceof Error ? error.message : String(error) }, 'Netgear scanner failed')
      throw error
    }
  },
}

export { invalidateConfigCache }
