const DELETED_ACCOUNT_EMAIL_PATTERN = /^deleted\+[^@\s]+@deleted\.thegrainline\.local$/;

export function isDeletedAccountEmail(email: string | null | undefined) {
  return typeof email === "string" && DELETED_ACCOUNT_EMAIL_PATTERN.test(email.trim().toLowerCase());
}

export function sellerFacingUserLabel(
  user: { name?: string | null; email?: string | null; deletedAt?: Date | string | null } | null | undefined,
  fallback: string,
) {
  if (!user || user.deletedAt || isDeletedAccountEmail(user.email)) return fallback;
  return user.name ?? user.email ?? fallback;
}

export function sellerFacingOrderBuyerLabel(
  order: {
    buyerName?: string | null;
    buyerEmail?: string | null;
    buyerDataPurgedAt?: Date | string | null;
    buyer?: { deletedAt?: Date | string | null } | null;
  },
  fallback: string,
) {
  if (order.buyerDataPurgedAt || order.buyer?.deletedAt || isDeletedAccountEmail(order.buyerEmail)) {
    return fallback;
  }
  return order.buyerName ?? order.buyerEmail ?? fallback;
}
