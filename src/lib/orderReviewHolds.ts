import type { Prisma } from "@prisma/client";

export const DEAUTHORIZED_SELLER_REVIEW_NOTE =
  "Seller Stripe account was deauthorized after payment. Staff must review payout and fulfillment state before further action.";
export const DEAUTHORIZED_SELLER_REVIEW_NOTE_PREFIX =
  "Seller Stripe account was deauthorized after payment.";
export const DEAUTHORIZED_SELLER_REVIEW_NOTE_SQL_PATTERN = `${DEAUTHORIZED_SELLER_REVIEW_NOTE_PREFIX}%`;
export const DEAUTHORIZED_SELLER_FULFILLMENT_HOLD_MESSAGE =
  "Staff must review payout and fulfillment state before shipping or purchasing labels.";

export function orderHasDeauthorizedSellerReviewHold(order: {
  sellerDeauthorizedAt: Date | string | null | undefined;
}) {
  return order.sellerDeauthorizedAt != null;
}

export function deauthorizedSellerReviewHoldWhere(): Prisma.OrderWhereInput {
  return {
    sellerDeauthorizedAt: { not: null },
  };
}
