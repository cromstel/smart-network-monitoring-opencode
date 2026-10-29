import * as settingsRepo from '@/lib/db/repositories/settingsRepository'
import { eventBusInstance, type SettingsChangedEvent } from '@/lib/services/eventBus'
import { logger } from '@/lib/utils/logger'
import type { UserSettings } from '@/lib/types/settings'

export type UserSettingsPatch = Partial<
  Pick<
    UserSettings,
    | 'scanIntervalSeconds'
    | 'dataRetentionDays'
    | 'networkSubnet'
    | 'ignoreSubnets'
    | 'notifyNewDevices'
    | 'notifyDeviceOffline'
    | 'notifyHighBandwidth'
    | 'bandwidthThreshold'
    | 'theme'
    | 'paystackApiUrl'
    | 'paystackSecret'
    | 'paystackAccessToken'
    | 'paystackSubscriptionId'
  >
>

/** Reads the caller's settings, creating defaults on first access. */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  const existing = await settingsRepo.findUserSettings(userId)
  if (existing) return existing

  const created = await settingsRepo.upsertUserSettings({ userId })
  logger.info({ userId }, 'created default user settings')
  return created
}

export async function saveUserSettings(
  userId: string,
  patch: UserSettingsPatch
): Promise<UserSettings> {
  // Ensure the row exists so the update path always has something to modify.
  await getUserSettings(userId)
  const saved = await settingsRepo.upsertUserSettings({ ...patch, userId })

  // Only a patch with fields in it is a change worth telling the group about;
  // the no-op save (empty object) would otherwise notify on every form submit.
  //
  // `changedKeys` are column *names* only — never values. The patch carries
  // secrets (`paystackSecret`, `paystackAccessToken`), and an admin-group
  // notification that quoted them would write credentials into every inbox and
  // every admin's notification list. Naming the field ("an administrator
  // updated: paystackSecret") is the audit signal; the value stays in the
  // settings row where it belongs.
  const changedKeys = Object.keys(patch)
  if (changedKeys.length > 0) {
    const event: SettingsChangedEvent = {
      type: 'settings.changed',
      timestamp: new Date().toISOString(),
      payload: { changedKeys, actorUserId: userId },
    }
    try {
      eventBusInstance.emit(event)
    } catch (err) {
      // The save already succeeded; a bus problem must not fail the request.
      logger.error({ err, changedKeys }, 'failed to emit settings.changed event')
    }
  }

  return saved
}
