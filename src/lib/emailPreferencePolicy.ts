import {
  isValidEmailPreferenceKey,
  type EmailNotificationPreferenceKey,
} from "./notificationPreferenceKeys.ts";

export const ALWAYS_ON_EMAIL_PREFERENCE_KEYS = [
  "EMAIL_NEW_ORDER",
  "EMAIL_CASE_OPENED",
  "EMAIL_CASE_MESSAGE",
  "EMAIL_CASE_RESOLVED",
  "EMAIL_REFUND_ISSUED",
] as const satisfies readonly EmailNotificationPreferenceKey[];

const ALWAYS_ON_EMAIL_PREFERENCE_KEY_SET = new Set<string>(
  ALWAYS_ON_EMAIL_PREFERENCE_KEYS,
);

export function isAlwaysOnEmailPreferenceKey(
  key: unknown,
): key is (typeof ALWAYS_ON_EMAIL_PREFERENCE_KEYS)[number] {
  return typeof key === "string" && ALWAYS_ON_EMAIL_PREFERENCE_KEY_SET.has(key);
}

export function isOptionalEmailPreferenceKey(
  key: unknown,
): key is EmailNotificationPreferenceKey {
  return typeof key === "string"
    && isValidEmailPreferenceKey(key)
    && !isAlwaysOnEmailPreferenceKey(key);
}

export function emailPreferenceKeyForDelivery(
  key: EmailNotificationPreferenceKey | null | undefined,
): EmailNotificationPreferenceKey | null {
  return key && !isAlwaysOnEmailPreferenceKey(key) ? key : null;
}
