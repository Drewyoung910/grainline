// The four-step progress line on the buyer's My account overview.
export type OrderProgressStep = Readonly<{ label: string; state: "done" | "current" | "upcoming" }>;

const SHIPPING_STEPS = ["Ordered", "Being made", "Shipped", "Delivered"] as const;
const PICKUP_STEPS = ["Ordered", "Being made", "Ready for pickup", "Picked up"] as const;

const STATUS_INDEX: Record<string, number> = {
  PENDING: 1,
  READY_FOR_PICKUP: 2,
  SHIPPED: 2,
  PICKED_UP: 3,
  DELIVERED: 3,
};

export function orderIsPickup(input: { shippingTitle?: string | null; fulfillmentStatus?: string | null }): boolean {
  return (
    input.fulfillmentStatus === "READY_FOR_PICKUP"
    || input.fulfillmentStatus === "PICKED_UP"
    || /pickup/i.test(input.shippingTitle ?? "")
  );
}

export function orderProgressSteps(input: {
  fulfillmentStatus?: string | null;
  shippingTitle?: string | null;
}): OrderProgressStep[] {
  const labels = orderIsPickup(input) ? PICKUP_STEPS : SHIPPING_STEPS;
  const current = STATUS_INDEX[input.fulfillmentStatus ?? "PENDING"] ?? 1;
  return labels.map((label, index) => ({
    label,
    state: index < current ? "done" : index === current ? "current" : "upcoming",
  }));
}

// How far along the line to fill, 0 to 1.
export function orderProgressFraction(steps: readonly OrderProgressStep[]): number {
  const current = steps.findIndex((step) => step.state === "current");
  return current < 0 ? 1 : current / Math.max(1, steps.length - 1);
}

// The newest order still on its way to the buyer. Refunded orders are excluded
// by the caller's flag, because only the page knows the payment state.
export function activeOrder<T extends { fulfillmentStatus?: string | null }>(
  orders: readonly T[],
  isSettled: (order: T) => boolean,
): T | null {
  return orders.find((order) => {
    const status = order.fulfillmentStatus ?? "PENDING";
    return status !== "DELIVERED" && status !== "PICKED_UP" && !isSettled(order);
  }) ?? null;
}
