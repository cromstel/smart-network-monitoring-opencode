import { selectScanner, setAsusScanner } from '../selector'
import { simulatedScanner } from '../simulatedScanner'
import { arpScanner } from '../arpScanner'
import { Scanner } from '../types'

const mockArpScanner = arpScanner as jest.Mocked<typeof arpScanner>

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(() => ({ SCANNER_MODE: 'simulated' as const })),
}))

jest.mock('@/lib/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}))

jest.mock('@/lib/services/scanners/arpScanner', () => ({
  arpScanner: {
    name: 'arp' as const,
    isAvailable: jest.fn().mockResolvedValue(false),
    scan: jest.fn(),
    _cachedAvailable: null as boolean | null,
  },
}))

const { getConfig } = require('@/lib/config')
const { logger } = require('@/lib/utils/logger')

describe('scanner fallback chain', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setAsusScanner(null)
    getConfig.mockReturnValue({ SCANNER_MODE: 'simulated' })
    mockArpScanner.isAvailable.mockReset()
    mockArpScanner.isAvailable.mockResolvedValue(false)
  })

  it('uses simulated when SCANNER_MODE=simulated', async () => {
    const scanner = await selectScanner()
    expect(scanner.name).toBe('simulated')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ scanner: 'simulated' }),
      expect.stringContaining('explicitly requested')
    )
  })

  it('falls back to simulated when requested scanner unavailable', async () => {
    getConfig.mockReturnValueOnce({ SCANNER_MODE: 'arp' })

    const scanner = await selectScanner()
    expect(scanner.name).toBe('simulated')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 'arp', fallback: 'simulated' }),
      expect.any(String)
    )
  })

  it('uses ARP when explicitly requested and available', async () => {
    getConfig.mockReturnValueOnce({ SCANNER_MODE: 'arp' })
    mockArpScanner.isAvailable.mockResolvedValueOnce(true)

    const scanner = await selectScanner()
    expect(scanner.name).toBe('arp')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ scanner: 'arp' }),
      expect.any(String)
    )
  })

  it('returns simulated when ARP unavailable and no ASUS', async () => {
    getConfig.mockReturnValueOnce({ SCANNER_MODE: 'arp' })
    mockArpScanner.isAvailable.mockResolvedValueOnce(false)

    const scanner = await selectScanner()
    expect(scanner.name).toBe('simulated')
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ fallback: 'simulated' }),
      expect.stringContaining('no hardware scanner')
    )
  })

  it('tries ASUS before ARP when ASUS scanner is set', async () => {
    getConfig.mockReturnValueOnce({ SCANNER_MODE: 'arp' })

    const mockAsus: Scanner = {
      name: 'asus',
      isAvailable: jest.fn().mockResolvedValue(true),
      scan: jest.fn(),
    }
    setAsusScanner(mockAsus)

    const scanner = await selectScanner()
    expect(scanner.name).toBe('asus')
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ scanner: 'asus' }),
      expect.any(String)
    )
  })
})