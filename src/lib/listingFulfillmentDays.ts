export const MIN_LISTING_FULFILLMENT_DAYS = 1;
export const MAX_LISTING_FULFILLMENT_DAYS = 365;

export type ListingFulfillmentDayResult =
  | { ok: true; value: number | null }
  | { ok: false; error: string };

export function parseListingFulfillmentDays(
  value: unknown,
  label: string,
): ListingFulfillmentDayResult {
  const raw = typeof value === "string" ? value.trim() : value;
  if (raw === "" || raw === null || raw === undefined) {
    return { ok: true, value: null };
  }

  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_LISTING_FULFILLMENT_DAYS ||
    parsed > MAX_LISTING_FULFILLMENT_DAYS
  ) {
    return {
      ok: false,
      error: `${label} must be a whole number from ${MIN_LISTING_FULFILLMENT_DAYS} to ${MAX_LISTING_FULFILLMENT_DAYS} days.`,
    };
  }

  return { ok: true, value: parsed };
}

export function listingProcessingWindowError(
  minimumDays: number | null,
  maximumDays: number | null,
) {
  return minimumDays !== null && maximumDays !== null && minimumDays > maximumDays
    ? "Processing time minimum cannot exceed the maximum."
    : null;
}
