import { lookupVendor, normalizeMac } from '../oui'

function firstLine(s: string | null): string | null {
  return s?.split('\n')[0] ?? null
}

describe('OUI vendor lookup', () => {
  it('normalizes MAC addresses to uppercase colon format', () => {
    expect(normalizeMac('a4:83:e7:2c:11:09')).toBe('A4:83:E7:2C:11:09')
    expect(normalizeMac('A4-83-E7-2C-11-09')).toBe('A4:83:E7:2C:11:09')
    expect(normalizeMac('a483e72c1109')).toBe('A4:83:E7:2C:11:09')
    expect(normalizeMac('  a4:83:e7:2c:11:09  ')).toBe('A4:83:E7:2C:11:09')
  })

  it('returns known vendor for Apple OUI', () => {
    expect(firstLine(lookupVendor('A4:83:E7:2C:11:09'))).toBe('Apple, Inc.')
    expect(firstLine(lookupVendor('a4-83-e7-2c-11-09'))).toBe('Apple, Inc.')
  })

  it('returns vendor for a known OUI (Dell)', () => {
    expect(firstLine(lookupVendor('58:8A:5A:71:CC:2F'))).toBe('Dell Inc.')
  })

  it('returns vendor for another known OUI (Cisco)', () => {
    expect(firstLine(lookupVendor('00:00:0C:00:00:00'))).toBe('Cisco Systems, Inc')
  })

  it('returns null for invalid/short MAC', () => {
    expect(lookupVendor('AA:BB')).toBeNull()
    expect(lookupVendor('')).toBeNull()
  })

  it('handles mixed case and separators', () => {
    expect(firstLine(lookupVendor('a4-83-e7-2c-11-09'))).toBe('Apple, Inc.')
    expect(firstLine(lookupVendor('a483e72c1109'))).toBe('Apple, Inc.')
  })
})