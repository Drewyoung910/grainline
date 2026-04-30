export const LOW_STOCK_DEDUP_WINDOW_MS = 72 * 60 * 60 * 1000;

export function lowStockNotificationLink(listingId: string) {
  return `/dashboard/listings/${listingId}/edit`;
}

export function nextManualStockQuantity({
  currentQuantity,
  requestedQuantity,
  expectedQuantity,
}: {
  currentQuantity: number | null | undefined;
  requestedQuantity: number;
  expectedQuantity?: number | null | undefined;
}) {
  const requested = Math.max(0, Math.floor(requestedQuantity));
  if (expectedQuantity == null) return requested;
  const expected = Math.max(0, Math.floor(expectedQuantity));
  const current = Math.max(0, Math.floor(currentQuantity ?? 0));
  return Math.max(0, current + (requested - expected));
}

export function stockStatusAfterManualUpdate({
  previousStatus,
  isPrivate,
  nextQuantity,
}: {
  previousStatus: string | null | undefined;
  isPrivate?: boolean | null | undefined;
  nextQuantity: number;
}) {
  if (nextQuantity <= 0) return "SOLD_OUT";
  if (previousStatus === "SOLD_OUT" && isPrivate !== true) return "ACTIVE";
  return previousStatus ?? "SOLD_OUT";
}

export function stockAlertBody(stockQuantity: number | null | undefined) {
  const count = Math.max(0, Math.floor(stockQuantity ?? 0));
  return count > 0
    ? `The piece you saved is available again. Current stock: ${count}.`
    : "The piece you saved may be available again. Check the listing for current stock.";
}

export function cartItemExceedsLiveStock({
  listingType,
  quantity,
  stockQuantity,
}: {
  listingType?: string | null | undefined;
  quantity: number;
  stockQuantity?: number | null | undefined;
}) {
  if (listingType !== "IN_STOCK") return false;
  return quantity > Math.max(0, stockQuantity ?? 0);
}
