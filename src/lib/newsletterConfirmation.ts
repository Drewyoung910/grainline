import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";

export const NEWSLETTER_CONFIRMATION_TOKEN_BYTES = 32;
export const NEWSLETTER_CONFIRMATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS = 15 * 60 * 1000;

export function createNewsletterConfirmationToken() {
  return randomBytes(NEWSLETTER_CONFIRMATION_TOKEN_BYTES).toString("base64url");
}

export function hashNewsletterConfirmationToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newsletterConfirmationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + NEWSLETTER_CONFIRMATION_TTL_MS);
}

export function canSendNewsletterConfirmation(lastSentAt: Date | null | undefined, now = new Date()) {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= NEWSLETTER_CONFIRMATION_RESEND_COOLDOWN_MS;
}

export function safeEqualNewsletterTokenHash(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function buildNewsletterConfirmationUrl(token: string) {
  const url = new URL("/api/newsletter/confirm", EMAIL_APP_URL);
  url.searchParams.set("token", token);
  url.searchParams.set("response", "html");
  return url.toString();
}
