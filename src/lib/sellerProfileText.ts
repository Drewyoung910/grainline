import { sanitizeRichText, truncateText } from "./sanitize";

export const SELLER_PROFILE_TEXT_LIMITS = {
  bio: 500,
  storyBody: 2000,
  policy: 2000,
} as const;

export function cleanSellerProfileRichText(
  value: FormDataEntryValue | string | null | undefined,
  maxLength: number,
): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const cleaned = sanitizeRichText(raw);
  return truncateText(cleaned, maxLength).trim() || null;
}
