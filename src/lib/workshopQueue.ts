// What a seller still has to do, worked out from data the page already read.
import { orderTotalCents } from "./orderTotals.ts";
import { orderPaymentPresentationState, suppressActiveFulfillmentForPaymentState } from "./orderPaymentPresentation.ts";

type QueueOrder = Readonly<{
  id: string;
  paidAt: Date | null;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrappingPriceCents: number | null;
  sellerRefundAmountCents: number | null;
  fulfillmentStatus: string | null;
}>;

type RefundOutcome = Readonly<{ amountCents?: number | null; status?: string | null }>;

// Paid, not started, and not refunded away. Matches what the sales list shows
// as active work.
export function ordersAwaitingFulfillment<T extends QueueOrder>(
  orders: readonly T[],
  refundOutcomes: ReadonlyMap<string, RefundOutcome>,
): T[] {
  return orders.filter((order) => {
    const status = order.fulfillmentStatus ?? "PENDING";
    if (status !== "PENDING") return false;
    const refundOutcome = refundOutcomes.get(order.id) ?? null;
    const paymentState = orderPaymentPresentationState({
      paid: order.paidAt != null,
      orderTotalCents: orderTotalCents(order, { itemsSubtotalCents: order.itemsSubtotalCents }),
      refundAmountCents: order.sellerRefundAmountCents ?? refundOutcome?.amountCents ?? null,
      refundRecorded: order.sellerRefundAmountCents != null,
      providerRefundStatus: refundOutcome?.status ?? null,
    });
    if (paymentState === "UNPAID") return false;
    return !suppressActiveFulfillmentForPaymentState(paymentState, status);
  });
}

// Whether a refund has taken this order out of active work, using the same rule
// as the sales list, so the two pages can't disagree about it.
export function orderRefundedAway(order: QueueOrder, refundOutcome: RefundOutcome | null): boolean {
  const status = order.fulfillmentStatus ?? "PENDING";
  const paymentState = orderPaymentPresentationState({
    paid: order.paidAt != null,
    orderTotalCents: orderTotalCents(order, { itemsSubtotalCents: order.itemsSubtotalCents }),
    refundAmountCents: order.sellerRefundAmountCents ?? refundOutcome?.amountCents ?? null,
    refundRecorded: order.sellerRefundAmountCents != null,
    providerRefundStatus: refundOutcome?.status ?? null,
  });
  return suppressActiveFulfillmentForPaymentState(paymentState, status);
}

// The Workshop header pill. Null means that read failed, which must not change it.
// Each closed label names what is missing. The setup wizard is not one of them:
// publishing needs only Stripe.
export function workshopShopStatus(input: Readonly<{
  vacationMode: boolean;
  chargesEnabled: boolean;
  acceptingNewOrders: boolean | null;
  liveListingCount: number | null;
}>): { label: string; open: boolean } {
  if (input.vacationMode) return { label: "On vacation", open: false };
  if (!input.chargesEnabled) return { label: "Payouts not connected", open: false };
  if (input.acceptingNewOrders === false) return { label: "Not taking orders", open: false };
  if (input.liveListingCount === 0) return { label: "No live listings", open: false };
  return { label: "Shop open", open: true };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export type WorkshopAttentionInput = Readonly<{
  ordersToShip: number;
  ordersToShipCapped: boolean;
  orderNames: readonly string[];
  unreadMessages: number;
  underReview: number;
  underReviewTitle: string | null;
  rejected: number;
  lowStock: ReadonlyArray<Readonly<{ title: string; stockQuantity: number }>>;
  // Null when unknown, so a failed read isn't taken for an empty shop.
  listingCount?: number | null;
  // Unresolved Cases on this maker's orders (open, in discussion, pending close,
  // or with staff, which includes Cases a bank chargeback opened).
  openCases?: number | null;
  // Shop state. Undefined or null means unknown, which adds no row.
  chargesEnabled?: boolean | null;
  liveListingCount?: number | null;
}>;

export type WorkshopAttentionRow = Readonly<{
  key: string;
  icon: "truck" | "message" | "alert" | "tag";
  title: string;
  detail: string;
  href: string;
}>;

// Most urgent first: money already paid, then people waiting, then shop state.
export function workshopAttentionRows(input: WorkshopAttentionInput): WorkshopAttentionRow[] {
  const rows: WorkshopAttentionRow[] = [];
  if (input.openCases && input.openCases > 0) {
    rows.push({
      key: "cases",
      icon: "alert",
      title: plural(input.openCases, "open case"),
      detail: "Open the order to see the case and any reply deadline",
      href: "/dashboard/sales",
    });
  }
  if (input.ordersToShip > 0) {
    const count = input.ordersToShipCapped ? `${input.ordersToShip}+ orders` : plural(input.ordersToShip, "order");
    rows.push({
      key: "orders",
      icon: "truck",
      title: `${count} to fulfill`,
      detail: input.orderNames.slice(0, 3).join(" · ") || "Paid and waiting on you",
      href: "/dashboard/sales",
    });
  } else if (input.ordersToShipCapped) {
    // Only the newest orders were read. An older one could still be waiting, so
    // this must not read as nothing to do.
    rows.push({
      key: "older-orders",
      icon: "truck",
      title: "Check your older orders",
      detail: "Only your newest 50 orders were checked here",
      href: "/dashboard/sales",
    });
  }
  if (input.unreadMessages > 0) {
    rows.push({
      key: "messages",
      icon: "message",
      title: `${plural(input.unreadMessages, "unread message")}`,
      detail: "Replying quickly counts toward your Guild response rate",
      href: "/messages",
    });
  }
  if (input.rejected > 0) {
    rows.push({
      key: "rejected",
      icon: "alert",
      title: `${plural(input.rejected, "listing")} sent back`,
      detail: "Edit and resubmit to go live",
      href: "/dashboard/listings?status=rejected",
    });
  }
  if (input.underReview > 0) {
    rows.push({
      key: "review",
      icon: "alert",
      title: `${plural(input.underReview, "listing")} under review`,
      detail: input.underReviewTitle
        ? `${input.underReviewTitle} · we'll notify you when it's decided`
        : "We'll notify you when it's decided",
      href: "/dashboard/listings?status=review",
    });
  }
  if (input.lowStock.length > 0) {
    rows.push({
      key: "low-stock",
      icon: "tag",
      title: "Running low",
      detail: input.lowStock.map((item) => `${item.title}: ${item.stockQuantity} left`).join(" · "),
      href: "/dashboard/listings?status=stock",
    });
  }
  if (input.chargesEnabled === false) {
    rows.push({
      key: "payouts",
      icon: "alert",
      title: "Connect payouts to go live",
      detail: "Buyers can't see or buy your pieces until Stripe payouts are set up",
      href: "/dashboard/seller",
    });
  }
  if (
    input.liveListingCount === 0
    && (input.listingCount ?? 0) > 0
    && input.underReview === 0
    && input.rejected === 0
  ) {
    rows.push({
      key: "nothing-live",
      icon: "tag",
      title: "Nothing is live",
      detail: "Publish a draft or unhide a listing so buyers can order",
      href: "/dashboard/listings",
    });
  }
  if (input.listingCount === 0) {
    rows.push({
      key: "first-listing",
      icon: "tag",
      title: "List your first piece",
      detail: "Your workshop is empty. Add a listing to start selling",
      href: "/dashboard/listings/new",
    });
  }
  return rows;
}

// The Listings page filter. Anything unrecognized falls back to all.
export const WORKSHOP_LISTING_FILTERS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "stock", label: "In stock" },
  { value: "review", label: "Under review" },
  { value: "rejected", label: "Sent back" },
  { value: "draft", label: "Drafts" },
  { value: "hidden", label: "Hidden" },
  { value: "soldout", label: "Sold out" },
  { value: "sold", label: "Sold" },
] as const;

export type WorkshopListingFilter = (typeof WORKSHOP_LISTING_FILTERS)[number]["value"];

export function parseWorkshopListingFilter(raw: unknown): WorkshopListingFilter {
  return WORKSHOP_LISTING_FILTERS.some((filter) => filter.value === raw) ? (raw as WorkshopListingFilter) : "all";
}

const FILTER_STATUS: Partial<Record<WorkshopListingFilter, string>> = {
  active: "ACTIVE",
  review: "PENDING_REVIEW",
  rejected: "REJECTED",
  draft: "DRAFT",
  hidden: "HIDDEN",
  soldout: "SOLD_OUT",
  sold: "SOLD",
};

export function workshopListingFilterStatus(filter: WorkshopListingFilter): string | null {
  return FILTER_STATUS[filter] ?? null;
}

// Counts per tab from per-status totals. "In stock" needs its own count.
export function workshopListingFilterCounts(
  statusCounts: Readonly<Record<string, number>>,
  inStockCount: number,
): Record<WorkshopListingFilter, number> {
  const total = Object.values(statusCounts).reduce((sum, value) => sum + value, 0);
  const counts = { all: total, stock: inStockCount } as Record<WorkshopListingFilter, number>;
  for (const filter of WORKSHOP_LISTING_FILTERS) {
    const status = FILTER_STATUS[filter.value];
    if (status) counts[filter.value] = statusCounts[status] ?? 0;
  }
  return counts;
}
