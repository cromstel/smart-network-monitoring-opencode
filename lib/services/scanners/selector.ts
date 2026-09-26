import { Scanner, ScannerMode } from './types'
import { simulatedScanner } from './simulatedScanner'
import { arpScanner } from './arpScanner'
import { asusScanner } from './asusScanner'
import { getConfig } from '@/lib/config'
import { logger } from '@/lib/utils/logger'

export async function selectScanner(): Promise<Scanner> {
  const cfg = getConfig()
  const requested = cfg.SCANNER_MODE

  if (requested === 'simulated') {
    logger.info({ scanner: 'simulated' }, 'using simulated scanner (explicitly requested)')
    return simulatedScanner
  }

  const requestedScanner = await getNamedScanner(requested)
  if (requestedScanner) {
    const available = await requestedScanner.isAvailable()
    if (available) {
      logger.info({ scanner: requestedScanner.name }, 'using explicitly requested scanner')
      return requestedScanner
    }
    logger.warn(
      { requested: requestedScanner.name, fallback: 'simulated' },
      'requested scanner unavailable, falling back'
    )
  }

  if (asusScanner) {
    const available = await asusScanner.isAvailable()
    if (available) {
      logger.info({ scanner: 'asus' }, 'ASUS router scanner available, using it')
      return asusScanner
    }
    logger.warn({ fallback: 'arp' }, 'ASUS router scanner unavailable, falling back to ARP')
  }

  const arpAvailable = await arpScanner.isAvailable()
  if (arpAvailable) {
    logger.info({ scanner: 'arp' }, 'ARP scanner available, using it')
    return arpScanner
  }

  logger.warn({ fallback: 'simulated' }, 'no hardware scanner available, falling back to simulated')
  return simulatedScanner
}

async function getNamedScanner(mode: ScannerMode): Promise<Scanner | null> {
  switch (mode) {
    case 'arp':
      return arpScanner
    case 'asus':
      return asusScanner
    default:
      return null
  }
}