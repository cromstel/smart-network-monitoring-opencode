import { Scanner, ScannerMode } from './types'
import { simulatedScanner } from './simulatedScanner'
import { arpScanner } from './arpScanner'
import { asusScanner } from './asusScanner'
import { tplinkScanner } from './tplinkScanner'
import { netgearScanner } from './netgearScanner'
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
    logger.warn({ fallback: 'tplink' }, 'ASUS router scanner unavailable, trying TP-Link')
  }

  if (tplinkScanner) {
    const available = await tplinkScanner.isAvailable()
    if (available) {
      logger.info({ scanner: 'tplink' }, 'TP-Link router scanner available, using it')
      return tplinkScanner
    }
    logger.warn({ fallback: 'netgear' }, 'TP-Link router scanner unavailable, trying Netgear')
  }

  if (netgearScanner) {
    const available = await netgearScanner.isAvailable()
    if (available) {
      logger.info({ scanner: 'netgear' }, 'Netgear router scanner available, using it')
      return netgearScanner
    }
    logger.warn({ fallback: 'arp' }, 'Netgear router scanner unavailable, falling back to ARP')
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
    case 'tplink':
      return tplinkScanner
    case 'netgear':
      return netgearScanner
    default:
      return null
  }
}