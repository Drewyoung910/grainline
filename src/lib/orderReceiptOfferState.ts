import type { OrderPaymentPresentationState } from "./orderPaymentPresentation.ts";

const ACTIVE_CASE_STATUSES = new Set([
  "OPEN",
  "IN_DISCUSSION",
  "PENDING_CLOSE",
  "UNDER_REVIEW",
]);

export function canOfferBuyerReceiptConfirmation(input: {
  fulfillmentMethod: string | null | undefined;
  fulfillmentStatus: string | null | undefined;
  caseStatus: string | null | undefined;
  paymentState: OrderPaymentPresentationState;
}): boolean {
  // This is a presentation gate. The locked database transition remains the
  // authority for dispute and stock-restoration evidence that this page does
  // not project.
  if (input.caseStatus && ACTIVE_CASE_STATUSES.has(input.caseStatus)) return false;
  if (input.paymentState !== "PAID" && input.paymentState !== "PARTIALLY_REFUNDED") {
    return false;
  }
  return (
    input.fulfillmentMethod === "SHIPPING"
    && input.fulfillmentStatus === "SHIPPED"
  ) || (
    input.fulfillmentMethod === "PICKUP"
    && input.fulfillmentStatus === "READY_FOR_PICKUP"
  );
}
