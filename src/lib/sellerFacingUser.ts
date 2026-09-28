export function sellerFacingUserLabel(
  user: { name?: string | null; deletedAt?: Date | string | null } | null | undefined,
  fallback: string,
) {
  if (!user || user.deletedAt) return fallback;
  return user.name ?? fallback;
}

export function sellerFacingOrderBuyerLabel(
  order: {
    buyerName?: string | null;
    buyerDataPurgedAt?: Date | string | null;
    buyerDeletedAt?: Date | string | null;
    buyer?: { deletedAt?: Date | string | null } | null;
  },
  fallback: string,
) {
  if (
    order.buyerDataPurgedAt
    || order.buyerDeletedAt
    || order.buyer?.deletedAt
  ) {
    return fallback;
  }
  return order.buyerName ?? fallback;
}
