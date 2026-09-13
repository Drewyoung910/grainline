export type CheckoutSessionExpiryMetadata = {
  listingId?: string | null;
  reservedStock?: string | null;
};

export function reservedStockMetadataIncludesListing(reservedStock: string | null | undefined, listingId: string) {
  return (reservedStock ?? "")
    .split(",")
    .some((token) => token.split(":")[0] === listingId);
}

export function checkoutSessionMetadataReferencesListing(
  metadata: CheckoutSessionExpiryMetadata | null | undefined,
  listingId: string,
) {
  if (!metadata) return false;
  return metadata.listingId === listingId || reservedStockMetadataIncludesListing(metadata.reservedStock, listingId);
}
