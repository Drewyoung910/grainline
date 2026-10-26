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
  // Back-in-stock delivery is tied to the listing-level SOLD_OUT -> ACTIVE
  // transition. Variant-only restocks need their own subscription/delivery
  // contract before they can be offered here.
  if (!publicListingDetail || isPrivate) return false;
  if (listingType !== "IN_STOCK") return false;
  if (status !== "ACTIVE" && status !== "SOLD_OUT") return false;
  return (stockQuantity ?? 0) <= 0;
}
