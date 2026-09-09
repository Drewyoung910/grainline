export type OrderCheckoutRefundReviewOutcome =
  | "missing_payment_intent"
  | "refund_exists"
  | "open_dispute"
  | "state_changed"
  | "provider_failure";

export function checkoutRefundReviewOutcomeFromRows(
  rows: readonly Record<string, unknown>[],
): OrderCheckoutRefundReviewOutcome {
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("checkout refund review authority returned invalid cardinality");
  }
  if (
    row.outcome !== "missing_payment_intent"
    && row.outcome !== "refund_exists"
    && row.outcome !== "open_dispute"
    && row.outcome !== "state_changed"
    && row.outcome !== "provider_failure"
  ) {
    throw new TypeError("checkout refund review authority returned invalid outcome");
  }
  if (Object.keys(row).length !== 1) {
    throw new TypeError("checkout refund review authority returned unexpected fields");
  }
  return row.outcome;
}
