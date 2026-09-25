import type { Device, EnrichedDevice } from '@/lib/types'
import { toDeviceDTO } from '../serialisers'

const BIG_UPLOAD = '18446744073709551615' // 2^64 - 1, > Number.MAX_SAFE_INTEGER

function buildEnriched(overrides: Partial<EnrichedDevice> = {}): EnrichedDevice {
  const base: Device = {
    id: 'd1',
    macAddress: 'A4:83:E7:2C:11:09',
    ipAddress: '192.168.1.42',
    hostname: 'anas-iphone',
    deviceName: 'Ana\'s iPhone',
    deviceType: 'phone',
    manufacturer: 'Apple, Inc.',
    signalStrength: -52,
    status: 'online',
    isBlocked: false,
    isIgnored: false,
    totalConnectionTimeSeconds: 1840233,
    categoryId: null,
    firstSeen: new Date('2026-08-01T09:12:00.000Z'),
    lastSeen: new Date('2026-09-24T10:00:00.000Z'),
    createdAt: new Date('2026-08-01T09:12:00.000Z'),
    updatedAt: new Date('2026-09-24T10:00:00.000Z'),
  }
  return {
    device: base,
    network: {
      lastSeenAt: new Date('2026-09-24T10:00:00.000Z'),
      uploadMbps: 0.8,
      downloadMbps: 12.4,
      uploadBytes: BIG_UPLOAD,
      downloadBytes: '9123847112300000000',
    },
    ...overrides,
  }
}

describe('toDeviceDTO', () => {
  it('keeps byte counters as exact strings above Number.MAX_SAFE_INTEGER', () => {
    const dto = toDeviceDTO(buildEnriched())

    expect(dto.totalTransferred.uploadBytes).toBe(BIG_UPLOAD)

    const serialised = JSON.stringify(dto)
    // Numeric coercion would emit a rounded float; the verbatim string must survive.
    expect(serialised).toContain(`"uploadBytes":"${BIG_UPLOAD}"`)
    expect(Number(BIG_UPLOAD)).not.toBe(Number.MAX_SAFE_INTEGER + 1)
  })

  it('falls back to zeroed stats when a device has no network data', () => {
    const dto = toDeviceDTO(buildEnriched({ network: null }))

    expect(dto.currentBandwidth).toEqual({ uploadMbps: 0, downloadMbps: 0 })
    expect(dto.totalTransferred).toEqual({ uploadBytes: '0', downloadBytes: '0' })
  })

  it('emits ISO timestamps and numeric speeds', () => {
    const dto = toDeviceDTO(buildEnriched())

    expect(dto.firstSeen).toBe('2026-08-01T09:12:00.000Z')
    expect(dto.currentBandwidth.downloadMbps).toBe(12.4)
    expect(dto.totalConnectionTimeSeconds).toBe(1840233)
  })
})