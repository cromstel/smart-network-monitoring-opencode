import { Scanner, DiscoveredDevice } from './types'

const SIM_DEVICES: DiscoveredDevice[] = [
  { macAddress: 'A4:83:E7:2C:11:09', ipAddress: '192.168.1.42', hostname: 'anas-iphone', signalStrength: -52 },
  { macAddress: '3C:22:FB:44:90:12', ipAddress: '192.168.1.43', hostname: 'anas-macbook', signalStrength: -47 },
  { macAddress: '58:8A:5A:71:CC:2F', ipAddress: '192.168.1.44', hostname: 'living-tv', signalStrength: undefined },
  { macAddress: 'D8:43:AE:12:AB:77', ipAddress: '192.168.1.45', hostname: 'sonos-kitchen', signalStrength: -61 },
  { macAddress: 'B0:39:56:0D:39:11', ipAddress: '192.168.1.46', hostname: 'hp-office', signalStrength: undefined },
  { macAddress: 'F8:E4:3B:5A:90:C8', ipAddress: '192.168.1.47', hostname: 'ring-doorbell', signalStrength: -70 },
  { macAddress: '34:E6:D7:00:BE:3A', ipAddress: '192.168.1.48', hostname: 'synology-nas', signalStrength: undefined },
  { macAddress: '04:9F:3E:22:11:5B', ipAddress: '192.168.1.49', hostname: 'desk-laptop', signalStrength: -55 },
  { macAddress: '98:DA:32:7F:06:44', ipAddress: '192.168.1.50', hostname: 'kindle', signalStrength: -58 },
  { macAddress: '48:CA:43:99:1B:E0', ipAddress: '192.168.1.51', hostname: 'nest-thermostat', signalStrength: -64 },
  { macAddress: '1C:B7:2C:44:FF:02', ipAddress: '192.168.1.52', hostname: 'game-ps5', signalStrength: -50 },
  { macAddress: '6C:37:2B:EE:26:81', ipAddress: '192.168.1.53', hostname: 'unifi-switch', signalStrength: undefined },
]

export const simulatedScanner: Scanner = {
  name: 'simulated',

  async isAvailable(): Promise<boolean> {
    return true
  },

  async scan(_subnet: string): Promise<DiscoveredDevice[]> {
    return SIM_DEVICES.map((d) => ({
      ...d,
      signalStrength: d.signalStrength ?? undefined,
    }))
  },
}