import { Scanner, DiscoveredDevice } from './types'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { logger } from '@/lib/utils/logger'

const ARP_SCAN_BIN = process.platform === 'win32' ? 'arp-scan.exe' : 'arp-scan'

function which(bin: string): Promise<string | null> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const proc = spawn(cmd, [bin])
    proc.on('close', (code) => {
      resolve(code === 0 ? bin : null)
    })
    proc.on('error', () => resolve(null))
  })
}

function hasRawCapability(): Promise<boolean> {
  if (process.platform === 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', `getcap $(which ${ARP_SCAN_BIN}) 2>/dev/null || true`])
    let out = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.on('close', () => resolve(out.includes('cap_net_raw')))
    proc.on('error', () => resolve(false))
  })
}

function parseArpScanOutput(output: string): DiscoveredDevice[] {
  const devices: DiscoveredDevice[] = []
  const lines = output.split('\n')
  const macRegex = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i

  for (const line of lines) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const [ip, mac, ...rest] = parts
    if (!macRegex.test(mac)) continue
    devices.push({
      macAddress: mac.toUpperCase(),
      ipAddress: ip,
      hostname: rest.length > 0 ? rest.join(' ') : undefined,
      signalStrength: undefined,
    })
  }
  return devices
}

export const arpScanner: Scanner = {
  name: 'arp',
  _cachedAvailable: null as boolean | null,

  async isAvailable(): Promise<boolean> {
    const cached = this._cachedAvailable
    if (cached !== null) return cached as boolean

    const binPath = await which(ARP_SCAN_BIN)
    if (!binPath) {
      logger.warn({ scanner: 'arp' }, 'arp-scan binary not found in PATH')
      this._cachedAvailable = false
      return false
    }

    const rawCap = await hasRawCapability()
    if (!rawCap && process.platform !== 'win32') {
      logger.warn(
        { scanner: 'arp', binary: binPath },
        'arp-scan found but lacks CAP_NET_RAW; requires root or setcap cap_net_raw+ep'
      )
      this._cachedAvailable = false
      return false
    }

    this._cachedAvailable = true
    return true
  },

  async scan(subnet: string): Promise<DiscoveredDevice[]> {
    const available = await this.isAvailable()
    if (!available) throw new Error('arpScanner unavailable')

    const binPath = await which(ARP_SCAN_BIN)
    if (!binPath) throw new Error('arp-scan binary disappeared')

    return new Promise((resolve, reject) => {
      const proc = spawn(binPath, ['--localnet', '--numeric', '--quiet', subnet], {
        timeout: 30_000,
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (d) => (stdout += d.toString()))
      proc.stderr.on('data', (d) => (stderr += d.toString()))

      proc.on('close', (code) => {
        if (code === 0) {
          resolve(parseArpScanOutput(stdout))
        } else {
          logger.error({ scanner: 'arp', code, stderr }, 'arp-scan failed')
          reject(new Error(`arp-scan exited with code ${code}: ${stderr}`))
        }
      })

      proc.on('error', (err) => {
        logger.error({ scanner: 'arp', err }, 'arp-scan spawn error')
        reject(err)
      })
    })
  },
}