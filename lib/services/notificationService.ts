import { sendEmail } from './emailService'
import { createVulnerabilityAlert, findUnreadForUser } from '@/lib/db/repositories/vulnerabilityAlertRepository'
import { isNotificationEnabled } from './notificationPreferences'
import { findById } from '@/lib/db/repositories/userRepository'

export async function notifyVulnerability(userId: string, deviceId: string | null, vulnerabilityType: string, severity: string, detail: string) {
  await createVulnerabilityAlert(userId, deviceId, vulnerabilityType, severity, detail)

  const enabled = await isNotificationEnabled(userId, 'unknown_device')
  if (!enabled) return

  const user = await findById(userId)
  const adminEmail = user?.email ?? 'admin@network.local'
  await sendEmail({
    to: adminEmail,
    subject: `[Network Monitor] Vulnerability Detected — ${vulnerabilityType}`,
    html: `<h2>Vulnerability Alert</h2>
<p><strong>Type:</strong> ${vulnerabilityType}</p>
<p><strong>Severity:</strong> ${severity}</p>
<p><strong>Device:</strong> ${deviceId ?? 'Unknown'}</p>
<p><strong>Details:</strong> ${detail}</p>`,
  })
}

export async function notifyUnknownDevice(userId: string, deviceName: string, macAddress: string) {
  await createVulnerabilityAlert(userId, null, 'unknown_device', 'medium', `Unknown device connected: ${deviceName} (${macAddress})`)

  const enabled = await isNotificationEnabled(userId, 'unknown_device')
  if (!enabled) return

  const user = await findById(userId)
  const adminEmail = user?.email ?? 'admin@network.local'
  await sendEmail({
    to: adminEmail,
    subject: `[Network Monitor] Unknown Device Connected`,
    html: `<h2>Unknown Device Alert</h2>
<p>A new device has connected to your network.</p>
<p><strong>Device:</strong> ${deviceName}</p>
<p><strong>MAC Address:</strong> ${macAddress}</p>`,
  })
}
