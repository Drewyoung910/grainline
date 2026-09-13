import {
  isValidEmailPreferenceKey,
  normalizeNotificationPreferences,
} from "./notificationPreferenceKeys.ts";

const DEFAULT_OFF_EMAIL_KEYS = new Set(["EMAIL_SELLER_BROADCAST"]);

export function emailPreferenceDefaultEnabled(prefKey: string): boolean {
  if (!isValidEmailPreferenceKey(prefKey)) return false;
  return !DEFAULT_OFF_EMAIL_KEYS.has(prefKey);
}

export function isEmailNotificationEnabled(preferences: unknown, prefKey: string): boolean {
  if (!isValidEmailPreferenceKey(prefKey)) return false;
  const normalized = normalizeNotificationPreferences(preferences);
  if (!emailPreferenceDefaultEnabled(prefKey)) {
    return normalized[prefKey] === true;
  }
  return normalized[prefKey] !== false;
}
