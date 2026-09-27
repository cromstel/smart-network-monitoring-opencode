import * as oui from 'oui-data'

const OUI_MAP: Record<string, string> = {}

for (const [prefix, vendor] of Object.entries(oui)) {
  const normalized = prefix.replace(/-/g, '').toUpperCase()
  OUI_MAP[normalized] = vendor
}

/** Exactly six octets, i.e. 12 hex digits. */
const MAC_HEX_LENGTH = 12

const MAC_COLON_FORM = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/
const MAC_COMPACT = /^[0-9A-Fa-f]{12}$/

export function isValidMac(macAddress: string): boolean {
  const trimmed = macAddress.trim()
  return MAC_COLON_FORM.test(trimmed) || MAC_COMPACT.test(trimmed)
}

/**
 * Normalises a MAC to uppercase colon-separated form.
 *
 * Throws on anything that is not a 48-bit address. The previous version
 * stripped non-hex characters, which silently turned `"not-a-mac"` into
 * `"A:C"` and wrote that to the database as a phantom device; a rejected row
 * in the scan log is far better than an undiagnosable ghost on the dashboard.
 */
export function normalizeMac(macAddress: string): string {
  const trimmed = macAddress.trim()
  const compact = trimmed.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()

  if (compact.length !== MAC_HEX_LENGTH) {
    throw new Error(`Invalid MAC address: ${JSON.stringify(macAddress)}`)
  }

  return (compact.match(/.{2}/g) as string[]).join(':')
}

export function lookupVendor(macAddress: string): string | null {
  const cleaned = macAddress.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  if (cleaned.length < 6) return null
  const prefix = cleaned.slice(0, 6)
  return OUI_MAP[prefix] ?? null
}
