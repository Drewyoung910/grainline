const REFUND_LOCK_SENTINEL = "pending";

type RefundResolution = "FULL" | "PARTIAL" | "REFUND_FULL" | "REFUND_PARTIAL" | "DISMISSED";

type OrderRefundTotals = {
  itemsSubtotalCents: number | null;
  shippingAmountCents: number | null;
  giftWrappingPriceCents: number | null;
  taxAmountCents: number | null;
};

export const STRIPE_DISPUTE_CLOSED_STATUSES = new Set(["won", "lost", "warning_closed"]);
export const NON_BLOCKING_REFUND_LEDGER_STATUSES = ["failed", "canceled", "cancelled"] as const;

export function orderRefundTotalCents(order: OrderRefundTotals) {
  return (
    (order.itemsSubtotalCents ?? 0) +
    (order.shippingAmountCents ?? 0) +
    (order.giftWrappingPriceCents ?? 0) +
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

export function isBlockingRefundLedgerEvent(event: {
  eventType?: string | null | undefined;
  status?: string | null | undefined;
}) {
  if (event.eventType !== "REFUND") return false;
  return !NON_BLOCKING_REFUND_LEDGER_STATUSES.includes(
    (event.status ?? "").toLowerCase() as (typeof NON_BLOCKING_REFUND_LEDGER_STATUSES)[number],
  );
}

export function blockingRefundLedgerWhere() {
  return {
    eventType: "REFUND",
    OR: [
      { status: null },
      { status: { notIn: [...NON_BLOCKING_REFUND_LEDGER_STATUSES] } },
    ],
  };
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

export function orderHasRefundLedger(order: {
  sellerRefundId?: string | null | undefined;
  paymentEvents?: Array<{ eventType?: string | null | undefined; status?: string | null | undefined }> | null | undefined;
}) {
  return Boolean(order.sellerRefundId) ||
    Boolean(order.paymentEvents?.some(isBlockingRefundLedgerEvent));
}

export function orderHasPurchasedLabel(order: { labelStatus?: string | null | undefined }) {
  return order.labelStatus === "PURCHASED";
}

export function refundLockAcquisitionConflictResponse(order: {
  sellerRefundId?: string | null | undefined;
  labelStatus?: string | null | undefined;
  paymentEvents?: Array<{ eventType?: string | null | undefined; status?: string | null | undefined }> | null | undefined;
} | null | undefined) {
  const refundConflict = sellerRefundConflictResponse(order?.sellerRefundId);
  if (refundConflict) return refundConflict;

  if (order && orderHasRefundLedger(order)) {
    return {
      status: 400,
      error: "A refund has already been issued for this order.",
    };
  }

  if (order && orderHasPurchasedLabel(order)) {
    return {
      status: 409,
      error: "Cannot refund this order after a shipping label has been purchased. Void or resolve the label first.",
    };
  }

  return {
    status: 409,
    error: "Refund state changed while processing. Refresh and try again.",
  };
}

export function latestRefundLedgerEvent<T extends {
  eventType?: string | null | undefined;
  status?: string | null | undefined;
}>(paymentEvents: T[] | null | undefined): T | null {
  return paymentEvents?.find(isBlockingRefundLedgerEvent) ?? null;
}

type RefundStockRestoreItem = {
  listingId: string;
  quantity: number;
  listing: { listingType: string | null | undefined };
};

export function refundStockRestoreQuantities(items: RefundStockRestoreItem[]) {
  const quantitiesByListing = new Map<string, number>();

  for (const item of items) {
    if (item.listing.listingType !== "IN_STOCK" || item.quantity <= 0) continue;
    quantitiesByListing.set(
      item.listingId,
      (quantitiesByListing.get(item.listingId) ?? 0) + item.quantity,
    );
  }

  return [...quantitiesByListing.entries()].map(([listingId, quantity]) => ({
    listingId,
    quantity,
  }));
}

export function shouldReactivateRefundedListing(listing: {
  status: string | null | undefined;
  listingType: string | null | undefined;
  stockQuantity: number | null | undefined;
  isPrivate?: boolean | null | undefined;
}) {
  return (
    listing.status === "SOLD_OUT" &&
    listing.listingType === "IN_STOCK" &&
    (listing.stockQuantity ?? 0) > 0 &&
    listing.isPrivate !== true
  );
}
