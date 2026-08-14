export type CheckoutReservationSourceItem = Readonly<{
  listingId: string;
  sellerId: string;
  quantity: number;
}>;

function canonicalCheckoutReservationSource(
  items: readonly CheckoutReservationSourceItem[],
): string | null {
  const quantities = new Map<string, CheckoutReservationSourceItem>();

  for (const item of items) {
    if (
      typeof item.listingId !== "string" ||
      item.listingId.length === 0 ||
      typeof item.sellerId !== "string" ||
      item.sellerId.length === 0 ||
      !Number.isSafeInteger(item.quantity) ||
      item.quantity < 1
    ) {
      return null;
    }

    const key = JSON.stringify([item.sellerId, item.listingId]);
    const quantity = (quantities.get(key)?.quantity ?? 0) + item.quantity;
    if (!Number.isSafeInteger(quantity)) return null;
    quantities.set(key, {
      listingId: item.listingId,
      sellerId: item.sellerId,
      quantity,
    });
  }

  return JSON.stringify(
    [...quantities.values()].sort((left, right) => (
      left.sellerId.localeCompare(right.sellerId) ||
      left.listingId.localeCompare(right.listingId)
    )),
  );
}

/**
 * Confirms that the inventory snapshot priced by the route is exactly the
 * inventory PostgreSQL derived while holding the CartItem/Listing locks.
 * Variant cart lines intentionally collapse to listing-level stock because
 * inventory is tracked on Listing, not per variant option.
 */
export function checkoutReservationSourceMatches(
  reservedItems: readonly CheckoutReservationSourceItem[],
  pricedItems: readonly CheckoutReservationSourceItem[],
): boolean {
  const reserved = canonicalCheckoutReservationSource(reservedItems);
  const priced = canonicalCheckoutReservationSource(pricedItems);
  return reserved !== null && priced !== null && reserved === priced;
}
