import { sanitizeEmailOutboxError } from "./emailOutboxSanitize.ts";
import { truncateText } from "./sanitize.ts";

export const CLERK_WEBHOOK_EVENT_STALE_PROCESSING_MS = 5 * 60 * 1000;
export const CLERK_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS = 500;

export type ClerkWebhookEventAction = "process" | "processed" | "in_progress";
export type ClerkWebhookCompletion = "completed" | "already_processed";
export type ClerkWebhookFailure = "failed" | "superseded";
export type ClerkWebhookEventReservation = Readonly<{
  action: ClerkWebhookEventAction;
  claimGeneration: bigint;
}>;

function claimGeneration(value: unknown): bigint {
  if (typeof value === "bigint" && value >= 0n) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("Clerk webhook lease returned an invalid claim generation");
}

export function clerkWebhookEventReservationFromRows(
  rows: readonly Readonly<{ action: unknown; claim_generation: unknown }>[],
): ClerkWebhookEventReservation {
  if (rows.length !== 1) {
    throw new Error("Clerk webhook lease returned an invalid row count");
  }
  const action = rows[0]?.action;
  if (action !== "process" && action !== "processed" && action !== "in_progress") {
    throw new Error("Clerk webhook lease returned an invalid action");
  }
  const generation = claimGeneration(rows[0]?.claim_generation);
  if (action === "process" && generation < 1n) {
    throw new Error("Clerk webhook process lease returned generation zero");
  }
  return Object.freeze({ action, claimGeneration: generation });
}

export function clerkWebhookCompletionFromRows(
  rows: readonly Readonly<{ result: unknown }>[],
): ClerkWebhookCompletion {
  const result = rows[0]?.result;
  if (rows.length !== 1 || (result !== "completed" && result !== "already_processed")) {
    if (result === "superseded") {
      throw new Error("Clerk webhook lease was superseded before completion");
    }
    throw new Error("Clerk webhook completion returned an invalid result");
  }
  return result;
}

export function clerkWebhookFailureFromRows(
  rows: readonly Readonly<{ result: unknown }>[],
): ClerkWebhookFailure {
  const result = rows[0]?.result;
  if (rows.length !== 1 || (result !== "failed" && result !== "superseded")) {
    throw new Error("Clerk webhook failure finalizer returned an invalid result");
  }
  return result;
}

export function clerkWebhookEventLastError(error: unknown) {
  return truncateText(
    sanitizeEmailOutboxError(error),
    CLERK_WEBHOOK_EVENT_LAST_ERROR_MAX_CHARS,
  );
}
