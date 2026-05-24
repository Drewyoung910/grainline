import { normalizeNotificationPreferences, type NotificationPreferenceKey } from "./notificationPreferenceKeys.ts";

const DEFAULT_OFF_EMAIL_KEYS = new Set(["EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER"]);

export function emailPreferenceDefaultEnabled(prefKey: string): boolean {
  return !DEFAULT_OFF_EMAIL_KEYS.has(prefKey);
}

export function isEmailNotificationEnabled(preferences: unknown, prefKey: string): boolean {
  const normalized = normalizeNotificationPreferences(preferences);
  const key = prefKey as NotificationPreferenceKey;
  if (!emailPreferenceDefaultEnabled(prefKey)) {
    return normalized[key] === true;
  }
  return normalized[key] !== false;
}
