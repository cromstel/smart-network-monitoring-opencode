import { EventEmitter } from 'node:events'
import { arpScanner } from '../arpScanner'

describe('arpScanner', () => {
  it('isAvailable resolves false when binary is missing (no throw)', async () => {
    await expect(arpScanner.isAvailable()).resolves.toBe(false)
  })

  it('isAvailable caches the result', async () => {
    await arpScanner.isAvailable()
    const start = Date.now()
    await arpScanner.isAvailable()
    expect(Date.now() - start).toBeLessThan(50)
  })

  it('scan throws when unavailable', async () => {
    await expect(arpScanner.scan('192.168.1.0/24')).rejects.toThrow(
      'arpScanner unavailable'
    )
  })

  // The regression this file had no coverage for. The three tests above all
  // take the "binary missing" path, so every one of them passes while `scan()`
  // is incapable of succeeding on any machine: the old argv was
  // `['--localnet', '--numeric', '--quiet', subnet]` and arp-scan rejects that
  // pair with "You can not specify targets with the --localnet option", exit 1.
  // F-02 and F-42 are both P0 and both depended on this call succeeding.
  //
  // The mock lives at this level because two describes need it. It answers
  // every spawn the module makes and records only the scan's argv — `which`,
  // the getcap gate and the exec probe are plumbing, not the subject.
  let spawnMock: jest.Mock

  beforeEach(() => {
    jest.resetModules()
    spawnMock = jest.fn()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  /**
   * Loads a fresh copy of the module with `child_process` mocked, so the
   * assertion is about the argv the module builds rather than about whatever
   * happens to be installed on the machine running the tests.
   *
   * `arpScanner` shells out up to four times: `which`/`where` to locate the
   * binary, `sh -c getcap ...` for the capability advertisement, an
   * `arp-scan --help` exec probe, and finally the scan itself. The first three
   * are answered as a healthy machine (`opts.probeFails` simulates a binary
   * getcap calls capable that the kernel refuses to exec) and only the scan's
   * arguments are recorded.
   */
  async function loadScanner(opts: { probeFails?: boolean } = {}): Promise<{
    scanner: typeof import('../arpScanner').arpScanner
    scanCalls: string[][]
  }> {
    const scanCalls: string[][] = []

    spawnMock.mockImplementation((bin: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()

      const isWhich = bin === 'which' || bin === 'where'
      if (isWhich) {
        setImmediate(() => proc.emit('close', 0))
        return proc
      }

      // `sh -c getcap ...` — the capability advertisement.
      if (bin === 'sh') {
        setImmediate(() => {
          proc.stdout.emit('data', '/usr/sbin/arp-scan cap_net_raw=eip\n')
          proc.emit('close', 0)
        })
        return proc
      }

      // `arp-scan --help` — the exec probe. On a machine where the file
      // capabilities exceed the bounding set this execve fails with EPERM,
      // which child_process surfaces as a spawn error, not an exit code.
      if (args.includes('--help')) {
        setImmediate(() => {
          if (opts.probeFails) {
            proc.emit('error', Object.assign(new Error('spawn EPERM'), { code: 'EPERM' }))
          } else {
            proc.emit('close', 0)
          }
        })
        return proc
      }

      scanCalls.push(args)
      setImmediate(() => {
        // arp-scan prints its interface line, then one MAC/IP pair per host.
        proc.stdout.emit(
          'data',
          'Interface: eth0, type: EN10MB, MAC: 00:15:5d:23:33:8d, IPv4: 192.168.1.11\n'
        )
        // Real output is "IP<tab>MAC<tab>vendor", and the parser requires three
        // fields — a bare two-column line is skipped, which is why the
        // fixture has to match the shape arp-scan actually emits.
        proc.stdout.emit('data', '192.168.1.1\tac:9e:17:b3:33:b0\tVendor\n')
        proc.emit('close', 0)
      })
      return proc
    })

    jest.doMock('node:child_process', () => ({ spawn: spawnMock }))
    const mod = await import('../arpScanner')
    return { scanner: mod.arpScanner, scanCalls }
  }

  it('passes the subnet as a target and never with --localnet', async () => {
    const { scanner, scanCalls } = await loadScanner()

    const devices = await scanner.scan('192.168.1.0/24')

    // Reaches the parser too, which is the point of going through the real
    // argv: a run that cannot spawn cannot parse either.
    expect(devices).toEqual([
      {
        macAddress: 'AC:9E:17:B3:33:B0',
        ipAddress: '192.168.1.1',
        hostname: 'Vendor',
        signalStrength: undefined,
      },
    ])

    expect(scanCalls).toHaveLength(1)
    const args = scanCalls[0]!
    // --localnet alongside a target is the exact pair arp-scan refuses.
    expect(args).not.toContain('--localnet')
    expect(args).toEqual(['--numeric', '--quiet', '192.168.1.0/24'])
  })

  // The capability gate only runs off Windows, so these force `linux` — the
  // platform CI actually runs on, and the one where the gate can be wrong.
  describe('capability gate', () => {
    const originalPlatform = process.platform

    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
    })

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('rejects a getcap-positive binary the kernel refuses to exec', async () => {
      // getcap prints "cap_net_raw" while execve returns EPERM — the exact
      // state a setcap of cap_net_admin under Docker's default bounding set
      // produces. Trusting getcap alone reported the scanner available and
      // every scan died at spawn.
      const { scanner } = await loadScanner({ probeFails: true })
      await expect(scanner.isAvailable()).resolves.toBe(false)
    })

    it('accepts a getcap-positive binary that actually execs', async () => {
      const { scanner } = await loadScanner()
      await expect(scanner.isAvailable()).resolves.toBe(true)
    })
  })
})