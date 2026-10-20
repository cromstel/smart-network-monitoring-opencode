import * as settingsRepo from '@/lib/db/repositories/settingsRepository'
import type { AlertType, UserSettings } from '@/lib/types'

/**
 * Per-owner notification preferences (PRD F-52).
 *
 * The three toggles on the settings page (`notifyNewDevices`,
 * `notifyDeviceOffline`, `notifyHighBandwidth`) are stored per user, and alert
 * rules are per user too — so the check is per rule owner, never global. A
 * household where one person wants "new device" alerts and another does not is
 * the reason this is a preference at all.
 *
 * Same write-only defect class as `runtimeSettings`, which is why this lives
 * beside it: before this module, saving a toggle changed a column and nothing
 * else.
 */

function isAlertType(type: string): type is AlertType {
  return (
    type === 'unknown_device' || type === 'device_offline' || type === 'bandwidth_exceeded'
  )
}

const TOGGLE_FOR_TYPE: Record<AlertType, keyof UserSettings> = {
  unknown_device: 'notifyNewDevices',
  device_offline: 'notifyDeviceOffline',
  bandwidth_exceeded: 'notifyHighBandwidth',
}

/**
 * Resolves the owner's toggle for an alert type.
 *
 * Fails **open** (returns true) when the setting cannot be read, matching
 * `permissionsFor`'s `canManage`: a missing row means the user never expressed
 * a preference, and the pre-existing behaviour was to always alert. Silently
 * dropping alerts because a settings row is absent would be the worse failure —
 * an alert that never fires is invisible, whereas a stuttered one is not.
 */
export async function isNotificationEnabled(
  userId: string,
  alertType: string
): Promise<boolean> {
  if (!isAlertType(alertType)) return true

  try {
    const settings = await settingsRepo.findUserSettings(userId)
    if (!settings) return true
    return settings[TOGGLE_FOR_TYPE[alertType]] !== false
  } catch {
    return true
  }
}
