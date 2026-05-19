import { normalizeUserText } from "@/lib/sanitize";

export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 1000;
export const NOTIFICATION_LINK_MAX_LENGTH = 2048;

export function limitNotificationText(value: string, maxLength: number): string {
  const limit = Math.max(0, Math.floor(maxLength));
  const normalized = normalizeUserText(value);
  const chars = Array.from(normalized);
  if (chars.length <= limit) return normalized;
  return chars.slice(0, limit).join("");
}
