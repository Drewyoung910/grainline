export const STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS = 2 * 60 * 1000;

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
