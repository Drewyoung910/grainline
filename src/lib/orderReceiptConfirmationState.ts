export type OrderReceiptConfirmationInput = {
  fulfillmentMethod: "PICKUP" | "SHIPPING" | null;
  fulfillmentStatus: "PENDING" | "READY_FOR_PICKUP" | "PICKED_UP" | "SHIPPED" | "DELIVERED";
};

export type OrderReceiptConfirmationTransition = {
  fulfillmentMethod: "PICKUP" | "SHIPPING";
  previousStatus: "READY_FOR_PICKUP" | "SHIPPED";
  newStatus: "PICKED_UP" | "DELIVERED";
  timestampField: "pickedUpAt" | "deliveredAt";
};

/**
 * Derives the only receipt transitions a buyer may confirm.
 *
 * Historical shipped Orders may have a null fulfillmentMethod, so SHIPPED
 * retains the existing null-as-SHIPPING compatibility. Pickup completion is
 * deliberately buyer-controlled: a seller may announce readiness, but must
 * not start the buyer's case-window clock by asserting that handoff occurred.
 */
export function orderReceiptConfirmationTransition(
  order: OrderReceiptConfirmationInput,
): OrderReceiptConfirmationTransition | null {
  if (
    order.fulfillmentStatus === "SHIPPED"
    && (order.fulfillmentMethod === "SHIPPING" || order.fulfillmentMethod === null)
  ) {
    return {
      fulfillmentMethod: "SHIPPING",
      previousStatus: "SHIPPED",
      newStatus: "DELIVERED",
      timestampField: "deliveredAt",
    };
  }

  if (
    order.fulfillmentStatus === "READY_FOR_PICKUP"
    && order.fulfillmentMethod === "PICKUP"
  ) {
    return {
      fulfillmentMethod: "PICKUP",
      previousStatus: "READY_FOR_PICKUP",
      newStatus: "PICKED_UP",
      timestampField: "pickedUpAt",
    };
  }

  return null;
}
