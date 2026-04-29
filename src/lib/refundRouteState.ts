const REFUND_LOCK_SENTINEL = "pending";

type RefundResolution = "FULL" | "PARTIAL" | "REFUND_FULL" | "REFUND_PARTIAL" | "DISMISSED";

type OrderRefundTotals = {
  itemsSubtotalCents: number | null;
  shippingAmountCents: number | null;
  taxAmountCents: number | null;
};

export const STRIPE_DISPUTE_CLOSED_STATUSES = new Set(["won", "lost", "warning_closed"]);

export function orderRefundTotalCents(order: OrderRefundTotals) {
  return (
    (order.itemsSubtotalCents ?? 0) +
    (order.shippingAmountCents ?? 0) +
    (order.taxAmountCents ?? 0)
  );
}

export function refundAmountForResolution(
  resolution: RefundResolution,
  order: OrderRefundTotals,
  requestedAmountCents: number | null | undefined,
) {
  if (resolution === "FULL" || resolution === "REFUND_FULL") {
    return orderRefundTotalCents(order);
  }
  return requestedAmountCents ?? null;
}

export function partialRefundInputError(
  resolution: RefundResolution,
  requestedAmountCents: number | null | undefined,
) {
  if ((resolution === "PARTIAL" || resolution === "REFUND_PARTIAL") && (!requestedAmountCents || requestedAmountCents <= 0)) {
    return "Refund amount is required and must be positive for partial refunds.";
  }
  return null;
}

export function partialRefundExceedsOrderTotal(
  resolution: RefundResolution,
  requestedAmountCents: number | null | undefined,
  order: OrderRefundTotals,
) {
  if (resolution !== "PARTIAL" && resolution !== "REFUND_PARTIAL") return false;
  if (!requestedAmountCents || requestedAmountCents <= 0) return false;
  return requestedAmountCents > orderRefundTotalCents(order);
}

export function isOpenStripeDisputeStatus(status: string | null | undefined) {
  return !STRIPE_DISPUTE_CLOSED_STATUSES.has((status ?? "").toLowerCase());
}

export function sellerRefundConflictResponse(sellerRefundId: string | null | undefined) {
  if (!sellerRefundId) return null;
  const pending = sellerRefundId === REFUND_LOCK_SENTINEL;
  return {
    status: pending ? 409 : 400,
    error: pending
      ? "A refund is already being processed for this order."
      : "A refund has already been issued for this order.",
  };
}
