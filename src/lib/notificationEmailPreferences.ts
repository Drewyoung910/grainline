const DEFAULT_OFF_EMAIL_KEYS = new Set(["EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER"]);

export function emailPreferenceDefaultEnabled(prefKey: string): boolean {
  return !DEFAULT_OFF_EMAIL_KEYS.has(prefKey);
}
