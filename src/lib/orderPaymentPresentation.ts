export type OrderPaymentPresentationState =
  | "UNPAID"
  | "PAID"
  | "REFUND_PROCESSING"
  | "PARTIALLY_REFUNDED"
  | "FULLY_REFUNDED";

const FINAL_REFUND_STATUSES = new Set(["succeeded"]);

export function isFinalRefundStatus(status: string | null | undefined) {
  return FINAL_REFUND_STATUSES.has((status ?? "").toLowerCase());
}

export function orderPaymentPresentationState(input: {
  paid: boolean;
  orderTotalCents: number;
  refundAmountCents: number | null | undefined;
  refundRecorded: boolean;
  providerRefundStatus?: string | null;
}): OrderPaymentPresentationState {
  if (!input.paid) return "UNPAID";

  const refundAmountCents = input.refundAmountCents ?? 0;
  const refundFinal = input.refundRecorded || isFinalRefundStatus(input.providerRefundStatus);
  const hasRefundSignal = input.refundRecorded
    || input.providerRefundStatus != null
    || refundAmountCents > 0;

  if (!hasRefundSignal) return "PAID";
  if (!refundFinal) return "REFUND_PROCESSING";
  if (refundAmountCents > 0 && refundAmountCents >= input.orderTotalCents) {
    return "FULLY_REFUNDED";
  }
  return "PARTIALLY_REFUNDED";
}

export function orderPaymentPresentationLabel(state: OrderPaymentPresentationState) {
  switch (state) {
    case "UNPAID": return "Unpaid";
    case "PAID": return "Paid";
    case "REFUND_PROCESSING": return "Refund processing";
    case "PARTIALLY_REFUNDED": return "Partially refunded";
    case "FULLY_REFUNDED": return "Fully refunded";
  }
}

export function suppressActiveFulfillmentForPaymentState(
  state: OrderPaymentPresentationState,
  fulfillmentStatus: string | null | undefined,
) {
  return state === "FULLY_REFUNDED"
    && fulfillmentStatus !== "DELIVERED"
    && fulfillmentStatus !== "PICKED_UP";
}
