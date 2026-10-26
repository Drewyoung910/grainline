export function stockNotificationSubscribedFromResponse(value: unknown, fallback: boolean): boolean {
  if (!value || typeof value !== "object") return fallback;
  const subscribed = (value as { subscribed?: unknown }).subscribed;
  return typeof subscribed === "boolean" ? subscribed : fallback;
}

export function stockNotificationAvailable({
  status,
  listingType,
  stockQuantity,
  isPrivate,
  publicListingDetail,
}: {
  status: string;
  listingType: string;
  stockQuantity: number | null;
  isPrivate: boolean;
  publicListingDetail: boolean;
}): boolean {
  // Delivery is bound to a listing-level SOLD_OUT -> ACTIVE transition.
  // Variant-only availability needs a separate subscription contract.
  if (!publicListingDetail || isPrivate) return false;
  if (listingType !== "IN_STOCK") return false;
  if (status !== "ACTIVE" && status !== "SOLD_OUT") return false;
  return (stockQuantity ?? 0) <= 0;
}
