import { normalizeNotificationPreferences, type NotificationPreferenceKey } from "./notificationPreferenceKeys.ts";

export function isInAppNotificationEnabled(
  preferences: unknown,
  type: string,
): boolean {
  const normalized = normalizeNotificationPreferences(preferences);
  return normalized[type as NotificationPreferenceKey] !== false;
}
