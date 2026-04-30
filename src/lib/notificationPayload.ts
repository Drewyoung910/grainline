export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 1000;
export const NOTIFICATION_LINK_MAX_LENGTH = 2048;
const BIDI_CONTROL_CHARS = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

export function limitNotificationText(value: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const normalized = value.normalize("NFKC").replace(BIDI_CONTROL_CHARS, "");
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return chars.slice(0, limit).join("");
}
