export const RESOLVABLE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"] as const;
export const ESCALATABLE_CASE_STATUSES = ["OPEN", "IN_DISCUSSION", "PENDING_CLOSE"] as const;

export function isResolvableCaseStatus(status: string | null | undefined) {
  return RESOLVABLE_CASE_STATUSES.includes(status as (typeof RESOLVABLE_CASE_STATUSES)[number]);
}

export function isEscalatableCaseStatus(status: string | null | undefined) {
  return ESCALATABLE_CASE_STATUSES.includes(status as (typeof ESCALATABLE_CASE_STATUSES)[number]);
}

export function caseEscalationAvailable(
  status: string | null | undefined,
  escalateUnlocksAt: Date | string | null | undefined,
  now = new Date(),
  counterpartyUnavailable = false,
) {
  if (!isEscalatableCaseStatus(status)) return false;
  if (counterpartyUnavailable) return true;
  // Available participants object by replying; only an unavailable recipient
  // unlocks the pending-close staff-review alternative.
  if (status === "PENDING_CLOSE") return false;
  if (!escalateUnlocksAt) return false;
  return new Date(escalateUnlocksAt).getTime() <= now.getTime();
}

export function caseResolutionMessage(status: string | null | undefined) {
  return status === "RESOLVED"
    ? "Case resolved by mutual agreement."
    : "Waiting for other party to confirm resolution.";
}
