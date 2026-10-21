import {
  isValidEmailPreferenceKey,
  normalizeNotificationPreferences,
} from "./notificationPreferenceKeys.ts";
import { isAlwaysOnEmailPreferenceKey } from "./emailPreferencePolicy.ts";

const DEFAULT_OFF_EMAIL_KEYS = new Set(["EMAIL_SELLER_BROADCAST"]);

export function emailPreferenceDefaultEnabled(prefKey: string): boolean {
  if (!isValidEmailPreferenceKey(prefKey)) return false;
  return !DEFAULT_OFF_EMAIL_KEYS.has(prefKey);
}

export function isEmailNotificationEnabled(preferences: unknown, prefKey: string): boolean {
  if (!isValidEmailPreferenceKey(prefKey)) return false;
  if (isAlwaysOnEmailPreferenceKey(prefKey)) return true;
  const normalized = normalizeNotificationPreferences(preferences);
  if (!emailPreferenceDefaultEnabled(prefKey)) {
    return normalized[prefKey] === true;
  }
  return normalized[prefKey] !== false;
}
