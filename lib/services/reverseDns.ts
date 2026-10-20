import { reverse } from 'node:dns/promises'
import { logger } from '@/lib/utils/logger'

/**
 * F-03: reverse-DNS hostname resolution.
 *
 * The scanners report a hostname when the *router* knows one (`wl_clientlist`
 * does; ARP does not) or when the device advertises one. On a typical home LAN
 * the router's table is partial and names like `192.168.1.51` are the norm, so
 * F-03 asks for a best-effort forward lookup as a fallback.
 *
 * Resolution is:
 *   - **timeout-bounded.** A PTR lookup against an unroutable address blocks
 *     for seconds; the scan cycle is on a timer and must not be held hostage by
 *     one unresponsive device on a /24.
 *   - **batched and capped.** At most `MAX_LOOKUPS` concurrent lookups per
 *     cycle. A /24 can be 254 addresses and a stalled resolver would otherwise
 *     open hundreds of sockets at once.
 *   - **never fatal.** Any failure (NXDOMAIN, timeout, no resolver configured)
 *     yields `null` and the caller keeps whatever the scanner already had.
 *
 * Results are cached in-process, including negative results, because a device
 * with no PTR record will still have none 30 seconds later, and re-asking on
 * every scan is the classic way to get rate-limited by the local resolver.
 */

const LOOKUP_TIMEOUT_MS = 1_500
const MAX_LOOKUPS = 32

type CacheEntry = { hostname: string | null; at: number }

const cache = new Map<string, CacheEntry>()

/** Hostnames change rarely; 10 minutes keeps a rename discoverable. */
const POSITIVE_TTL_MS = 10 * 60 * 1000
/** A negative answer is remembered for one scan interval-ish window. */
const NEGATIVE_TTL_MS = 60 * 1000

/** Exposed for tests. */
export function clearHostnameCache(): void {
  cache.clear()
}

function getCached(ip: string): string | null | undefined {
  const hit = cache.get(ip)
  if (!hit) return undefined

  const ttl = hit.hostname === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS
  if (Date.now() - hit.at > ttl) {
    cache.delete(ip)
    return undefined
  }
  return hit.hostname
}

function isPrivateAddress(ip: string): boolean {
  return (
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('127.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  )
}

/**
 * Resolves a single address, returning `null` when there is no usable PTR.
 *
 * The resolved name is trimmed of its trailing dot and rejected when it is
 * literally the address itself — some resolvers answer a PTR query with the IP,
 * and storing `192.168.1.51` as a *hostname* renders as a duplicate column in
 * the UI while looking like a successful lookup.
 */
export async function resolveHostname(ip: string): Promise<string | null> {
  const cached = getCached(ip)
  if (cached !== undefined) return cached

  let hostname: string | null = null

  try {
    // `reverse` is the PTR query. `lookup` would be forward (name -> address)
    // and silently return the address, so it cannot resolve a hostname at all.
    const names = await Promise.race([
      reverse(ip),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('reverse-DNS timeout')), LOOKUP_TIMEOUT_MS)
      ),
    ])

    const first = Array.isArray(names) ? names[0] : undefined
    if (typeof first === 'string') {
      const candidate = first.replace(/\.$/, '').trim()
      // Reject an answer that is just the address again: some resolvers echo
      // the query back, and storing it as a hostname duplicates the IP column.
      if (candidate && candidate !== ip && !/^\d{1,3}(\.\d{1,3}){3}$/.test(candidate)) {
        hostname = candidate
      }
    }
  } catch {
    hostname = null
  }

  cache.set(ip, { hostname, at: Date.now() })
  return hostname
}

/**
 * Resolves hostnames for a batch of addresses that do not already have one.
 *
 * Returns a MAC-keyed map so the caller can join it straight onto the scan
 * result without caring about ordering. Addresses that already have a hostname
 * from the scanner are not looked up at all — the router's answer is more
 * trustworthy than a PTR record and is what the device actually advertises.
 */
export async function resolveHostnamesForDevices(
  devices: Array<{ macAddress: string; ipAddress: string; hostname?: string }>
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>()

  const pending = devices.filter(
    (d) => !d.hostname && isPrivateAddress(d.ipAddress) && getCached(d.ipAddress) === undefined
  )

  if (pending.length === 0) return resolved

  for (let i = 0; i < pending.length; i += MAX_LOOKUPS) {
    const batch = pending.slice(i, i + MAX_LOOKUPS)
    const results = await Promise.all(
      batch.map(async (device) => ({
        mac: device.macAddress,
        hostname: await resolveHostname(device.ipAddress),
      }))
    )

    for (const { mac, hostname } of results) {
      if (hostname) resolved.set(mac.toUpperCase(), hostname)
    }
  }

  if (resolved.size > 0) {
    logger.debug({ resolved: resolved.size, attempted: pending.length }, 'reverse-DNS resolved hostnames')
  }

  return resolved
}
