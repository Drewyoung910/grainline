export type LabelClawbackFailureReason = "missing_transfer" | "stripe_reversal_failed";
export type LabelClawbackStatus = "RETRY_PENDING" | "RETRYING" | "REVERSED" | "MANUAL_REVIEW";

const REVIEW_NOTE_MAX_CHARS = 10_000;
const ERROR_MAX_CHARS = 500;
export const LABEL_CLAWBACK_MAX_ATTEMPTS = 5;

const RETRY_BACKOFF_MS = [
  15 * 60 * 1000,
  60 * 60 * 1000,
  6 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function boundedText(value: string, maxChars: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`;
}

export function labelClawbackErrorMessage(error: unknown) {
  if (error instanceof Error) return boundedText(error.message || error.name, ERROR_MAX_CHARS);
  if (typeof error === "string") return boundedText(error, ERROR_MAX_CHARS);
  return "Unknown Stripe reversal error";
}

export function labelClawbackReviewNote(opts: {
  amountCents: number;
  reason: LabelClawbackFailureReason;
  shippoTransactionId?: string | null;
  stripeTransferId?: string | null;
  errorMessage?: string | null;
}) {
  const labelRef = opts.shippoTransactionId ? `Shippo label ${opts.shippoTransactionId}` : "The purchased Shippo label";
  const amount = fmtCents(opts.amountCents);
  if (opts.reason === "missing_transfer") {
    return `${labelRef} cost ${amount}, but the order has no Stripe transfer ID. Staff must manually reconcile the label-cost deduction with the seller payout.`;
  }

  const transferRef = opts.stripeTransferId ? `transfer ${opts.stripeTransferId}` : "the seller transfer";
  const errorSuffix = opts.errorMessage ? ` Stripe error: ${boundedText(opts.errorMessage, ERROR_MAX_CHARS)}.` : "";
  return `${labelRef} cost ${amount}, but Stripe transfer reversal against ${transferRef} failed.${errorSuffix} Staff must retry or manually reconcile the label-cost deduction.`;
}

export function appendLabelClawbackReviewNote(existingNote: string | null | undefined, nextNote: string) {
  const existing = existingNote?.trim();
  if (!existing) return boundedText(nextNote, REVIEW_NOTE_MAX_CHARS);

  const separator = "\n\n";
  const boundedNext = boundedText(nextNote, REVIEW_NOTE_MAX_CHARS);
  const maxExisting = REVIEW_NOTE_MAX_CHARS - separator.length - boundedNext.length;
  if (maxExisting <= 0) return boundedNext.slice(0, REVIEW_NOTE_MAX_CHARS);

  const keptExisting =
    existing.length <= maxExisting
      ? existing
      : `${existing.slice(0, Math.max(0, maxExisting - 14)).trimEnd()}\n[truncated]`;

  return `${keptExisting}${separator}${boundedNext}`.slice(0, REVIEW_NOTE_MAX_CHARS);
}

export function labelClawbackIdempotencyKey(opts: {
  orderId: string;
  shippoTransactionId?: string | null;
  shippoRateObjectId?: string | null;
  amountCents: number;
}) {
  const labelRef = opts.shippoTransactionId || opts.shippoRateObjectId || "unknown-label";
  return `label-cost:${opts.orderId}:${labelRef}:${opts.amountCents}`;
}

export function labelClawbackBackoffMs(failedAttempts: number) {
  if (failedAttempts >= LABEL_CLAWBACK_MAX_ATTEMPTS) return null;
  const index = Math.max(0, failedAttempts - 1);
  return RETRY_BACKOFF_MS[index] ?? RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1];
}

export function labelClawbackNextAttemptAt(failedAttempts: number, now = new Date()) {
  const backoffMs = labelClawbackBackoffMs(failedAttempts);
  if (backoffMs == null) return null;
  return new Date(now.getTime() + backoffMs);
}

export function labelClawbackStatusAfterFailure(failedAttempts: number): Extract<LabelClawbackStatus, "RETRY_PENDING" | "MANUAL_REVIEW"> {
  return failedAttempts >= LABEL_CLAWBACK_MAX_ATTEMPTS ? "MANUAL_REVIEW" : "RETRY_PENDING";
}
