export type CartPriceReview = Readonly<{
  oldPriceCents: number;
  newPriceCents: number;
  oldPriceVersion: number;
  newPriceVersion: number;
}>;

export function cartPriceReviewState(input: CartPriceReview): CartPriceReview | null {
  if (
    input.oldPriceCents === input.newPriceCents
    && input.oldPriceVersion === input.newPriceVersion
  ) {
    return null;
  }
  return Object.freeze({ ...input });
}
