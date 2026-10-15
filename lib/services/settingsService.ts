import * as settingsRepo from '@/lib/db/repositories/settingsRepository'
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
  return settingsRepo.upsertUserSettings({ ...patch, userId })
}
