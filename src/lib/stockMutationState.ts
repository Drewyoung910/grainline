export const LOW_STOCK_DEDUP_WINDOW_MS = 72 * 60 * 60 * 1000;
export const MAX_MANUAL_STOCK_QUANTITY = 1_000_000;

export function normalizeManualStockQuantity(value: number | null | undefined) {
  if (!Number.isFinite(value ?? 0)) return 0;
  return Math.min(MAX_MANUAL_STOCK_QUANTITY, Math.max(0, Math.floor(value ?? 0)));
}

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
  const requested = normalizeManualStockQuantity(requestedQuantity);
  if (expectedQuantity == null) return requested;
  const expected = normalizeManualStockQuantity(expectedQuantity);
  const current = normalizeManualStockQuantity(currentQuantity);
  return normalizeManualStockQuantity(current + (requested - expected));
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
  const count = normalizeManualStockQuantity(stockQuantity);
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
