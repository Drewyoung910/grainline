export type OrderOpsHealthSummary = Readonly<{
  ambiguousRefundCount: number;
  staleRefundClaimCount: number;
  manualReviewLabelClawbackCount: number;
  overdueLabelClawbackRetryCount: number;
  agingReviewNeededCount: number;
  staleCheckoutReservationCount: number;
  recentPayoutFailureCount: number;
  issueCount: number;
}>;

type OrderOpsHealthRow = Readonly<{
  ambiguous_refund_count: unknown;
  stale_refund_claim_count: unknown;
  manual_review_label_clawback_count: unknown;
  overdue_label_clawback_retry_count: unknown;
  aging_review_needed_count: unknown;
  stale_checkout_reservation_count: unknown;
  recent_payout_failure_count: unknown;
  issue_count: unknown;
}>;

function nonnegativeCount(value: unknown, label: string) {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new Error(`Order ops health returned an invalid ${label}`);
  }
  if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Order ops health returned an out-of-range ${label}`);
  }
  return Number(parsed);
}

export function orderOpsHealthSummaryFromRows(
  rows: readonly OrderOpsHealthRow[],
): OrderOpsHealthSummary {
  if (rows.length !== 1) {
    throw new Error("Order ops health returned an invalid row count");
  }
  const row = rows[0];
  const summary = Object.freeze({
    ambiguousRefundCount: nonnegativeCount(
      row?.ambiguous_refund_count,
      "ambiguous refund count",
    ),
    staleRefundClaimCount: nonnegativeCount(
      row?.stale_refund_claim_count,
      "stale refund claim count",
    ),
    manualReviewLabelClawbackCount: nonnegativeCount(
      row?.manual_review_label_clawback_count,
      "manual-review label clawback count",
    ),
    overdueLabelClawbackRetryCount: nonnegativeCount(
      row?.overdue_label_clawback_retry_count,
      "overdue label clawback retry count",
    ),
    agingReviewNeededCount: nonnegativeCount(
      row?.aging_review_needed_count,
      "aging review-needed count",
    ),
    staleCheckoutReservationCount: nonnegativeCount(
      row?.stale_checkout_reservation_count,
      "stale checkout reservation count",
    ),
    recentPayoutFailureCount: nonnegativeCount(
      row?.recent_payout_failure_count,
      "recent payout failure count",
    ),
    issueCount: nonnegativeCount(row?.issue_count, "issue count"),
  });
  const componentTotal =
    summary.ambiguousRefundCount
    + summary.staleRefundClaimCount
    + summary.manualReviewLabelClawbackCount
    + summary.overdueLabelClawbackRetryCount
    + summary.agingReviewNeededCount
    + summary.staleCheckoutReservationCount
    + summary.recentPayoutFailureCount;
  if (!Number.isSafeInteger(componentTotal) || summary.issueCount !== componentTotal) {
    throw new Error("Order ops health returned inconsistent counts");
  }
  return summary;
}
