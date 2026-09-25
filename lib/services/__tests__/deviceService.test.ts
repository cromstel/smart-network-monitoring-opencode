import type { Device } from '@/lib/types'
import { listDevices, getDeviceById, markStaleDevicesOffline } from '../deviceService'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import * as bandwidthRepo from '@/lib/db/repositories/bandwidthRepository'
import * as connectionLogRepo from '@/lib/db/repositories/connectionLogRepository'

jest.mock('@/lib/db/repositories/deviceRepository')
jest.mock('@/lib/db/repositories/bandwidthRepository')
jest.mock('@/lib/db/repositories/connectionLogRepository')

const mockedDeviceRepo = jest.mocked(deviceRepo)
const mockedBandwidthRepo = jest.mocked(bandwidthRepo)
const mockedConnectionLogRepo = jest.mocked(connectionLogRepo)

const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z')

function buildDevice(overrides: Partial<Device> = {}): Device {
  return {
    id: 'd1',
    macAddress: 'A4:83:E7:2C:11:09',
    ipAddress: '192.168.1.42',
    hostname: 'test-device',
    deviceName: null,
    deviceType: 'unknown',
    manufacturer: 'Apple, Inc.',
    signalStrength: null,
    status: 'online',
    isBlocked: false,
    isIgnored: false,
    totalConnectionTimeSeconds: 0,
    categoryId: null,
    firstSeen: new Date('2025-12-01T00:00:00.000Z'),
    lastSeen: new Date('2025-12-31T23:59:30.000Z'),
    createdAt: new Date('2025-12-01T00:00:00.000Z'),
    updatedAt: new Date('2025-12-31T23:59:30.000Z'),
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers()
  jest.setSystemTime(FIXED_NOW)
  mockedBandwidthRepo.fetchStatsForDevices
    .mockResolvedValue(new Map())
})

afterEach(() => {
  jest.useRealTimers()
})

describe('markStaleDevicesOffline', () => {
  it('marks a device offline after two missed scans and logs the disconnect', async () => {
    const stale = buildDevice({ lastSeen: new Date('2025-12-31T23:58:30.000Z') })
    mockedDeviceRepo.findOnlineLastSeenBefore.mockResolvedValue([stale])

    const result = await markStaleDevicesOffline(30)
    // 30s interval * 2 missed scans = 60s cutoff; lastSeen is 90s before now.

    expect(mockedDeviceRepo.updateStatus).toHaveBeenCalledWith('d1', 'offline')
    expect(mockedConnectionLogRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'd1',
        eventType: 'disconnected',
      })
    )
    expect(result).toHaveLength(1)
  })

  it('does not touch devices seen within the cutoff', async () => {
    mockedDeviceRepo.findOnlineLastSeenBefore.mockResolvedValue([])

    await markStaleDevicesOffline(30)

    expect(mockedDeviceRepo.updateStatus).not.toHaveBeenCalled()
    expect(mockedConnectionLogRepo.insert).not.toHaveBeenCalled()
  })

  it('applies scanIntervalSeconds to the staleness cutoff', async () => {
    mockedDeviceRepo.findOnlineLastSeenBefore.mockResolvedValue([])

    await markStaleDevicesOffline(60)
    // 60s interval * 2 missed scans = 120s cutoff before fixed now (2026-01-01T00:00:00Z).

    expect(mockedDeviceRepo.findOnlineLastSeenBefore).toHaveBeenCalledWith(
      new Date('2025-12-31T23:58:00.000Z')
    )
    expect(mockedDeviceRepo.updateStatus).not.toHaveBeenCalled()
  })
})

describe('listDevices / getDeviceById enrichment', () => {
  it('decorates listed devices with their latest network stats', async () => {
    const device = buildDevice({ id: 'd1' })
    mockedDeviceRepo.listDevices.mockResolvedValue({
      data: [device],
      pagination: { page: 1, pageSize: 50, total: 1 },
    })
    mockedBandwidthRepo.fetchStatsForDevices.mockResolvedValue(
      new Map([
        [
          'd1',
          {
            lastSeenAt: FIXED_NOW,
            uploadMbps: 4.2,
            downloadMbps: 88.1,
            uploadBytes: '18446744073709551615',
            downloadBytes: '99999999999999999999',
          },
        ],
      ])
    )

    const result = await listDevices({})

    expect(mockedBandwidthRepo.fetchStatsForDevices).toHaveBeenCalledWith(['d1'])
    expect(result.data[0].network?.uploadMbps).toBe(4.2)
    expect(result.data[0].network?.uploadBytes).toBe('18446744073709551615')
  })

  it('returns null network when a device has no bandwidth samples', async () => {
    const device = buildDevice({ id: 'd1' })
    mockedDeviceRepo.findById.mockResolvedValue(device)

    const result = await getDeviceById('d1')

    expect(result?.network).toBeNull()
    expect(result?.device.id).toBe('d1')
  })

  it('returns null when the device does not exist', async () => {
    mockedDeviceRepo.findById.mockResolvedValue(null)

    await expect(getDeviceById('missing')).resolves.toBeNull()
  })
})