export type CheckoutCompletionReviewInput = {
  quotedPostalCode?: string | null;
  actualPostalCode?: string | null;
  quotedState?: string | null;
  actualState?: string | null;
  quotedCity?: string | null;
  actualCity?: string | null;
  quotedCountry?: string | null;
  actualCountry?: string | null;
  quotedShippingAmountCents?: number | null;
  actualShippingAmountCents?: number | null;
};

function normalizePostalCode(value: string) {
  return value.trim().split("-")[0];
}

function normalizeState(value: string) {
  return value.trim().toUpperCase();
}

function normalizeCity(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCountry(value: string) {
  return value.trim().toUpperCase();
}

export function checkoutCompletionNeedsReview({
  quotedPostalCode,
  actualPostalCode,
  quotedState,
  actualState,
  quotedCity,
  actualCity,
  quotedCountry,
  actualCountry,
  quotedShippingAmountCents,
  actualShippingAmountCents,
}: CheckoutCompletionReviewInput) {
  const addressMismatch =
    (!!quotedPostalCode && normalizePostalCode(quotedPostalCode) !== normalizePostalCode(actualPostalCode ?? "")) ||
    (!!quotedState && normalizeState(quotedState) !== normalizeState(actualState ?? "")) ||
    (!!quotedCity && normalizeCity(quotedCity) !== normalizeCity(actualCity ?? "")) ||
    (!!quotedCountry && normalizeCountry(quotedCountry) !== normalizeCountry(actualCountry ?? ""));

  const amountMismatch =
    quotedShippingAmountCents != null &&
    actualShippingAmountCents != null &&
    quotedShippingAmountCents !== actualShippingAmountCents;

  return addressMismatch || amountMismatch;
}
