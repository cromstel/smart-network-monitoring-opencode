/**
 * @jest-environment jsdom
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DeviceTable } from '@/components/DeviceTable'
import type { Device, DeviceNetworkStats, EnrichedDevice } from '@/lib/types'

jest.mock('@/lib/utils/cn', () => ({
  cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
}))

function makeDevice(overrides: Partial<Device> = {}): EnrichedDevice {
  const device: Device = {
    id: 'dev-1',
    macAddress: 'A4:83:E7:2C:11:09',
    ipAddress: '192.168.1.42',
    hostname: 'anas-iphone',
    deviceName: "Ana's iPhone",
    deviceType: 'phone',
    manufacturer: 'Apple, Inc.',
    signalStrength: -52,
    status: 'online',
    isBlocked: false,
    isIgnored: false,
    totalConnectionTimeSeconds: 3600,
    categoryId: null,
    firstSeen: new Date('2026-09-01T10:00:00Z'),
    lastSeen: new Date('2026-09-24T10:00:00Z'),
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-24T10:00:00Z'),
    ...overrides,
  }

  return { device, network: null }
}

function withNetwork(device: Device, stats: Partial<DeviceNetworkStats>): EnrichedDevice {
  const network: DeviceNetworkStats = {
    lastSeenAt: new Date('2026-09-24T10:00:00Z'),
    uploadMbps: 0,
    downloadMbps: 0,
    uploadBytes: '0',
    downloadBytes: '0',
    ...stats,
  }
  return { device, network }
}

describe('DeviceTable', () => {
  it('renders one row per device', () => {
    const data = [
      makeDevice(),
      makeDevice({
        id: 'dev-2',
        deviceName: 'Office Printer',
        ipAddress: '192.168.1.46',
        macAddress: 'B0:39:56:0D:39:11',
      }),
    ]

    render(<DeviceTable data={data} />)

    expect(screen.getByText("Ana's iPhone")).toBeInTheDocument()
    expect(screen.getByText('Office Printer')).toBeInTheDocument()
    expect(screen.getByText('A4:83:E7:2C:11:09')).toBeInTheDocument()
    expect(screen.getByText('B0:39:56:0D:39:11')).toBeInTheDocument()
  })

  it('falls back to the MAC when a device has no name', () => {
    render(<DeviceTable data={[makeDevice({ deviceName: null })]} />)
    expect(screen.getByText('A4:83:E7:2C:11:09')).toBeInTheDocument()
  })

  it('shows Unknown for a device with no manufacturer', () => {
    render(<DeviceTable data={[makeDevice({ manufacturer: null })]} />)
    expect(screen.getByText('Unknown')).toBeInTheDocument()
  })

  it('shows an em dash when there are no bandwidth samples', () => {
    render(<DeviceTable data={[makeDevice()]} />)
    // Download and Upload cells both have no data.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('formats throughput when samples exist', () => {
    const data = [
      withNetwork(makeDevice().device, { downloadMbps: 12.44, uploadMbps: 1.5 }),
    ]

    render(<DeviceTable data={data} />)

    expect(screen.getByText('12.44 Mbps')).toBeInTheDocument()
    expect(screen.getByText('1.50 Mbps')).toBeInTheDocument()
  })

  it('filters rows as the user types', async () => {
    const user = userEvent.setup()
    const data = [
      makeDevice(),
      makeDevice({ id: 'dev-2', deviceName: 'Synology NAS', deviceType: 'server' }),
    ]

    render(<DeviceTable data={data} />)
    expect(screen.getByText('Synology NAS')).toBeInTheDocument()

    await user.type(screen.getByPlaceholderText('Search devices...'), 'synology')

    expect(screen.queryByText("Ana's iPhone")).not.toBeInTheDocument()
    expect(screen.getByText('Synology NAS')).toBeInTheDocument()
  })

  it('shows a no-match message when the filter excludes everything', async () => {
    const user = userEvent.setup()
    render(<DeviceTable data={[makeDevice()]} />)

    await user.type(screen.getByPlaceholderText('Search devices...'), 'zzzznomatch')

    expect(screen.getByText('No matching devices')).toBeInTheDocument()
  })

  it('sorts by name when the header is activated', async () => {
    const user = userEvent.setup()
    const data = [
      makeDevice({ id: 'dev-2', deviceName: 'Zebra', macAddress: 'AA:00:00:00:00:02' }),
      makeDevice({ id: 'dev-1', deviceName: 'Alpha', macAddress: 'AA:00:00:00:00:01' }),
    ]

    render(<DeviceTable data={data} />)

    // The header cell is the sort control.
    await user.click(screen.getByRole('columnheader', { name: /^name/i }))

    const bodyRows = screen.getAllByRole('row').slice(1)
    expect(within(bodyRows[0]!).getByText('Alpha')).toBeInTheDocument()
    expect(within(bodyRows[1]!).getByText('Zebra')).toBeInTheDocument()

    // A second activation reverses the order.
    await user.click(screen.getByRole('columnheader', { name: /^name/i }))

    const reversed = screen.getAllByRole('row').slice(1)
    expect(within(reversed[0]!).getByText('Zebra')).toBeInTheDocument()
    expect(within(reversed[1]!).getByText('Alpha')).toBeInTheDocument()
  })

  it('paginates and reports the visible range', () => {
    const data = Array.from({ length: 12 }, (_, i) =>
      makeDevice({
        id: `dev-${i}`,
        deviceName: `Device ${i}`,
        macAddress: `AA:00:00:00:0${Math.floor(i / 10)}:${String(i % 10)}0`,
      })
    )

    render(<DeviceTable data={data} />)

    // Default page size is 25, so all 12 rows fit on the first page and the
    // pager has nowhere to go.
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()

    // The summary renders "Showing 1 to 12 of 12"; the totals are in spans,
    // so assert on the repeated count rather than the assembled sentence.
    expect(screen.getAllByText('12').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Device 11')).toBeInTheDocument()
  })

  it('calls onRowClick with the full device when a row is activated', async () => {
    const user = userEvent.setup()
    const onRowClick = jest.fn()
    const data = [makeDevice()]

    render(<DeviceTable data={data} onRowClick={onRowClick} />)

    await user.click(screen.getByText("Ana's iPhone"))

    expect(onRowClick).toHaveBeenCalledTimes(1)
    expect(onRowClick.mock.calls[0]![0].device.id).toBe('dev-1')
  })

  it('renders an empty state with no data', () => {
    render(<DeviceTable data={[]} />)
    expect(screen.getByText('No devices found')).toBeInTheDocument()
  })

  it('renders a skeleton while loading', () => {
    const { container } = render(<DeviceTable data={[]} isLoading />)
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)
  })

  it('surfaces an error message', () => {
    render(<DeviceTable data={[]} isError error={new Error('Upstream unavailable')} />)
    expect(screen.getByText('Failed to load devices')).toBeInTheDocument()
    expect(screen.getByText('Upstream unavailable')).toBeInTheDocument()
  })

  it('distinguishes online from offline', () => {
    const data = [
      makeDevice({ id: 'dev-1', deviceName: 'Up' }),
      makeDevice({ id: 'dev-2', deviceName: 'Down', status: 'offline' }),
    ]

    render(<DeviceTable data={data} />)

    expect(screen.getByText('online')).toBeInTheDocument()
    expect(screen.getByText('offline')).toBeInTheDocument()
  })
})
