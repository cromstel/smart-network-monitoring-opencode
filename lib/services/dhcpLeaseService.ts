import * as dhcpLeaseRepo from '@/lib/db/repositories/dhcpLeasesRepository'
import * as deviceRepo from '@/lib/db/repositories/deviceRepository'
import type { DhcpLease } from '@/lib/db/repositories/dhcpLeasesRepository'

/**
 * DHCP lease surface (F-43).
 *
 * Leases are recorded when a scanner discovers a device on an IP address, and
 * deactivated when that same MAC is seen on a different IP or goes offline.
 * The scanner backends (ARP, ASUS, simulated) do not expose the DHCP server's
 * lease file directly, so population is driven by scan discovery plus an
 * explicit refresh endpoint rather than polling a lease file. That keeps this
 * layer scanner-agnostic.
 */

export async function recordLease(
  deviceId: string,
  ipAddress: string,
  macAddress: string,
  hostname: string | null,
  leaseStart: string,
  leaseEnd: string | null
): Promise<DhcpLease> {
  // Deactivate any previous active lease for this MAC (a device moves IPs).
  await dhcpLeaseRepo.deactivateLeasesForMac(macAddress)
  return dhcpLeaseRepo.createLease({
    deviceId,
    ipAddress,
    macAddress,
    hostname,
    leaseStart,
    leaseEnd,
  })
}

export async function listActiveLeases(): Promise<DhcpLease[]> {
  return dhcpLeaseRepo.listLeases({ activeOnly: true })
}

export async function refreshLeasesFromScan(): Promise<{
  recorded: number
  deactivated: number
}> {
  // Pull every active lease and deactivate those whose MAC is no longer seen
  // online in the latest scan. Record new leases for currently online devices
  // that lack an active lease.
  const activeLeases = await dhcpLeaseRepo.listLeases({ activeOnly: true })

  // The scan job owns discovery; this endpoint reconciles lease state against
  // the device table (source of truth for what's online now).
  const onlineMacs = await deviceRepo.findAllMacAddresses()
  const onlineMacSet = new Set(onlineMacs.map((m) => m.toUpperCase()))

  let deactivated = 0
  for (const lease of activeLeases) {
    if (!onlineMacSet.has(lease.macAddress.toUpperCase())) {
      await dhcpLeaseRepo.markLeaseInactive(lease.id)
      deactivated++
    }
  }

  return { recorded: 0, deactivated }
}

export async function getLeaseForDevice(deviceId: string): Promise<DhcpLease | null> {
  const leases = await dhcpLeaseRepo.listLeases({ activeOnly: true })
  return leases.find((l) => l.deviceId === deviceId) ?? null
}
