import { sanitizeEmailOutboxError } from "./emailOutboxSanitize.ts";
import { truncateText } from "./sanitize.ts";

export const STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS = 2 * 60 * 1000;
export const STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS = 500;

const STRIPE_CARD_LAST4_PATTERNS = [
  /\b(?:last4|last_4|card_last4|card last4)\s*[:=]\s*\d{4}\b/gi,
  /\bending\s+(?:in|with)\s+\d{4}\b/gi,
];

export function shouldReclaimStripeWebhookEvent(
  event: { processedAt: Date | null; processingStartedAt: Date | null } | null | undefined,
  now = new Date(),
) {
  if (!event || event.processedAt) return false;
  if (!event.processingStartedAt) return true;
  if (!(event.processingStartedAt instanceof Date) || Number.isNaN(event.processingStartedAt.getTime())) {
    return true;
  }
  return event.processingStartedAt.getTime() < now.getTime() - STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS;
}

export function stripeWebhookEventLastError(error: unknown) {
  let sanitized = sanitizeEmailOutboxError(error);
  for (const pattern of STRIPE_CARD_LAST4_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[card_detail]");
  }
  return truncateText(sanitized, STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS);
}
