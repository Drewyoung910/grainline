export type SellerOrderBlockReason =
  | "inactive_account"
  | "vacation"
  | "not_accepting_orders";

export type SellerOrderState = {
  acceptingNewOrders?: boolean | null;
  vacationMode?: boolean | null;
  user?: {
    banned?: boolean | null;
    deletedAt?: Date | string | null;
  } | null;
};

export function sellerOrderBlockReason(
  seller: SellerOrderState | null | undefined,
): SellerOrderBlockReason | null {
  if (!seller) return "inactive_account";
  if (seller.user?.banned || seller.user?.deletedAt) return "inactive_account";
  if (seller.vacationMode) return "vacation";
  if (seller.acceptingNewOrders === false) return "not_accepting_orders";
  return null;
}

export function sellerOrderBlockMessage(reason: SellerOrderBlockReason) {
  switch (reason) {
    case "vacation":
      return "This seller is currently on vacation and not accepting new orders.";
    case "not_accepting_orders":
      return "This maker is not currently accepting new orders.";
    case "inactive_account":
    default:
      return "This seller is not currently accepting orders.";
  }
}
