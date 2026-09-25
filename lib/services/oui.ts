import * as oui from 'oui-data'

const OUI_MAP: Record<string, string> = {}

for (const [prefix, vendor] of Object.entries(oui)) {
  const normalized = prefix.replace(/-/g, '').toUpperCase()
  OUI_MAP[normalized] = vendor
}

export function lookupVendor(macAddress: string): string | null {
  const cleaned = macAddress.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  if (cleaned.length < 6) return null
  const prefix = cleaned.slice(0, 6)
  return OUI_MAP[prefix] ?? null
}

export function normalizeMac(macAddress: string): string {
  return macAddress
    .replace(/[^0-9A-Fa-f]/g, '')
    .toUpperCase()
    .replace(/(.{2})/g, '$1:')
    .slice(0, -1)
}