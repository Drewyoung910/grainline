import { sanitizeEmailOutboxError } from "./emailOutboxSanitize.ts";
import { truncateText } from "./sanitize.ts";

export const STRIPE_WEBHOOK_EVENT_STALE_PROCESSING_MS = 2 * 60 * 1000;
export const STRIPE_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS = 500;

export type StripeWebhookEventAction = "process" | "processed" | "in_progress";
export type StripeWebhookCompletion = "completed" | "already_processed";
export type StripeWebhookFailure = "failed" | "superseded";
export type StripeWebhookEventReservation = Readonly<{
  action: StripeWebhookEventAction;
  claimGeneration: bigint;
}>;

const STRIPE_CARD_LAST4_PATTERNS = [
  /\b(?:last4|last_4|card_last4|card last4)\s*[:=]\s*\d{4}\b/gi,
  /\bending\s+(?:in|with)\s+\d{4}\b/gi,
];

function stripeWebhookClaimGeneration(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("Stripe webhook lease returned an invalid claim generation");
}

export function stripeWebhookEventReservationFromRows(
  rows: readonly Readonly<{ action: unknown; claim_generation: unknown }>[],
): StripeWebhookEventReservation {
  if (rows.length !== 1) {
    throw new Error("Stripe webhook lease returned an invalid row count");
  }
  const action = rows[0]?.action;
  if (action !== "process" && action !== "processed" && action !== "in_progress") {
    throw new Error("Stripe webhook lease returned an invalid action");
  }
  const claimGeneration = stripeWebhookClaimGeneration(rows[0]?.claim_generation);
  if (action === "process" && claimGeneration < 1n) {
    throw new Error("Stripe webhook process lease returned generation zero");
  }
  return Object.freeze({ action, claimGeneration });
}

export function stripeWebhookCompletionFromRows(
  rows: readonly Readonly<{ result: unknown }>[],
): StripeWebhookCompletion {
  const result = rows[0]?.result;
  if (rows.length !== 1 || (result !== "completed" && result !== "already_processed")) {
    if (result === "superseded") {
      throw new Error("Stripe webhook lease was superseded before completion");
    }
    throw new Error("Stripe webhook completion returned an invalid result");
  }
  return result;
}

export function stripeWebhookFailureFromRows(
  rows: readonly Readonly<{ result: unknown }>[],
): StripeWebhookFailure {
  const result = rows[0]?.result;
  if (rows.length !== 1 || (result !== "failed" && result !== "superseded")) {
    throw new Error("Stripe webhook failure finalizer returned an invalid result");
  }
  return result;
}

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
