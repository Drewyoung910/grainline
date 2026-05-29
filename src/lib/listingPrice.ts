export const MAX_LISTING_PRICE_CENTS = 10_000_000;
export const MAX_LISTING_PRICE_DISPLAY = "$100,000";

export function listingPriceMaxError(priceCents: number) {
  return priceCents > MAX_LISTING_PRICE_CENTS
    ? `Price cannot exceed ${MAX_LISTING_PRICE_DISPLAY}.`
    : null;
}
