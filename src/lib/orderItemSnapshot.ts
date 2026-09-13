const MAX_SNAPSHOT_TITLE_LENGTH = 200;
const MAX_SNAPSHOT_DESCRIPTION_LENGTH = 5000;
const MAX_SNAPSHOT_SELLER_NAME_LENGTH = 100;
const MAX_SNAPSHOT_IMAGE_URLS = 24;
const MAX_SNAPSHOT_IMAGE_URL_LENGTH = 2048;
const MAX_SNAPSHOT_TAGS = 50;
const MAX_SNAPSHOT_TAG_LENGTH = 100;
const MAX_PROCESSING_DAYS = 3650;
const MAX_SHIPPING_WEIGHT_GRAMS = 500_000;
const MAX_SHIPPING_DIMENSION_CM = 1_000;

export type CheckoutShippingPackageSnapshot = Readonly<{
  shippingWeightGrams: number | null;
  shippingLengthCm: number | null;
  shippingWidthCm: number | null;
  shippingHeightCm: number | null;
  shippingPackageComplete: boolean;
}>;

export type HistoricalOrderItemSnapshot = {
  title: string;
  description: string | null;
  priceCents: number;
  imageUrls: string[];
  category: string | null;
  tags: string[];
  sellerName: string;
  capturedAt: string | null;
  listingType: "IN_STOCK" | "MADE_TO_ORDER" | null;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  shipsWithinDays: number | null;
  shippingWeightGrams: number | null;
  shippingLengthCm: number | null;
  shippingWidthCm: number | null;
  shippingHeightCm: number | null;
  shippingPackageComplete: boolean;
  complete: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.length <= maxLength ? value : null;
}

function boundedNonNegativeInteger(value: unknown, max: number): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max
    ? Number(value)
    : null;
}

function boundedStringArray(
  value: unknown,
  maxItems: number,
  maxItemLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  if (!value.every((item) => typeof item === "string" && item.length <= maxItemLength)) {
    return null;
  }
  return [...value];
}

function optionalBoundedString(value: unknown, maxLength: number): string | null {
  if (value == null) return null;
  return boundedString(value, maxLength);
}

function optionalBoundedDayCount(value: unknown): number | null {
  if (value == null) return null;
  return boundedNonNegativeInteger(value, MAX_PROCESSING_DAYS);
}

function optionalPositiveNumber(value: unknown, max: number): number | null {
  if (value == null) return null;
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
    ? value
    : null;
}

function checkoutShippingPackageSnapshot(value: {
  shippingWeightGrams?: unknown;
  shippingLengthCm?: unknown;
  shippingWidthCm?: unknown;
  shippingHeightCm?: unknown;
}): CheckoutShippingPackageSnapshot {
  const shippingWeightGrams = optionalPositiveNumber(
    value.shippingWeightGrams,
    MAX_SHIPPING_WEIGHT_GRAMS,
  );
  const shippingLengthCm = optionalPositiveNumber(
    value.shippingLengthCm,
    MAX_SHIPPING_DIMENSION_CM,
  );
  const shippingWidthCm = optionalPositiveNumber(
    value.shippingWidthCm,
    MAX_SHIPPING_DIMENSION_CM,
  );
  const shippingHeightCm = optionalPositiveNumber(
    value.shippingHeightCm,
    MAX_SHIPPING_DIMENSION_CM,
  );
  const shippingPackageComplete =
    shippingWeightGrams !== null &&
    shippingLengthCm !== null &&
    shippingWidthCm !== null &&
    shippingHeightCm !== null;
  return Object.freeze({
    shippingWeightGrams,
    shippingLengthCm,
    shippingWidthCm,
    shippingHeightCm,
    shippingPackageComplete,
  });
}

/**
 * Seals package facts into Stripe's immutable checkout-line product metadata.
 * Incomplete packages carry only an explicit false marker; callers must not
 * reconstruct missing checkout facts from a later mutable Listing.
 */
export function checkoutShippingPackageMetadata(value: {
  shippingWeightGrams?: unknown;
  shippingLengthCm?: unknown;
  shippingWidthCm?: unknown;
  shippingHeightCm?: unknown;
}): Record<string, string> {
  const packageSnapshot = checkoutShippingPackageSnapshot(value);
  if (!packageSnapshot.shippingPackageComplete) {
    return { shippingPackageComplete: "false" };
  }
  return {
    shippingPackageComplete: "true",
    shippingWeightGrams: String(packageSnapshot.shippingWeightGrams),
    shippingLengthCm: String(packageSnapshot.shippingLengthCm),
    shippingWidthCm: String(packageSnapshot.shippingWidthCm),
    shippingHeightCm: String(packageSnapshot.shippingHeightCm),
  };
}

/** Reads only a complete, bounded package witness returned by Stripe. */
export function readCheckoutShippingPackageMetadata(
  metadata: Record<string, string> | null | undefined,
): CheckoutShippingPackageSnapshot {
  if (metadata?.shippingPackageComplete !== "true") {
    return checkoutShippingPackageSnapshot({});
  }
  const parse = (value: string | undefined) =>
    typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value)
      : null;
  const packageSnapshot = checkoutShippingPackageSnapshot({
    shippingWeightGrams: parse(metadata.shippingWeightGrams),
    shippingLengthCm: parse(metadata.shippingLengthCm),
    shippingWidthCm: parse(metadata.shippingWidthCm),
    shippingHeightCm: parse(metadata.shippingHeightCm),
  });
  return packageSnapshot.shippingPackageComplete
    ? packageSnapshot
    : checkoutShippingPackageSnapshot({});
}

/**
 * Reads checkout-time facts for retained order history.
 *
 * Invalid or predecessor snapshots deliberately fall back to generic retained
 * facts instead of mutable Listing title/photo/seller data. `complete=false`
 * is therefore safe to render and remains measurable for legacy convergence.
 */
export function readHistoricalOrderItemSnapshot(
  value: unknown,
  fallbackPriceCents: number,
): HistoricalOrderItemSnapshot {
  const fallback: HistoricalOrderItemSnapshot = {
    title: "Purchased item",
    description: null,
    priceCents: Math.max(0, Number.isSafeInteger(fallbackPriceCents) ? fallbackPriceCents : 0),
    imageUrls: [],
    category: null,
    tags: [],
    sellerName: "Maker",
    capturedAt: null,
    listingType: null,
    processingTimeMinDays: null,
    processingTimeMaxDays: null,
    shipsWithinDays: null,
    shippingWeightGrams: null,
    shippingLengthCm: null,
    shippingWidthCm: null,
    shippingHeightCm: null,
    shippingPackageComplete: false,
    complete: false,
  };
  if (!isRecord(value)) return fallback;

  const title = boundedString(value.title, MAX_SNAPSHOT_TITLE_LENGTH);
  const description = optionalBoundedString(value.description, MAX_SNAPSHOT_DESCRIPTION_LENGTH);
  const priceCents = boundedNonNegativeInteger(value.priceCents, Number.MAX_SAFE_INTEGER);
  const imageUrls = boundedStringArray(
    value.imageUrls,
    MAX_SNAPSHOT_IMAGE_URLS,
    MAX_SNAPSHOT_IMAGE_URL_LENGTH,
  );
  const category = optionalBoundedString(value.category, 100);
  const tags = boundedStringArray(value.tags, MAX_SNAPSHOT_TAGS, MAX_SNAPSHOT_TAG_LENGTH);
  const sellerName = boundedString(value.sellerName, MAX_SNAPSHOT_SELLER_NAME_LENGTH);
  const capturedAt = optionalBoundedString(value.capturedAt, 64);
  const listingType =
    value.listingType === "IN_STOCK" || value.listingType === "MADE_TO_ORDER"
      ? value.listingType
      : null;
  const processingTimeMinDays = optionalBoundedDayCount(value.processingTimeMinDays);
  const processingTimeMaxDays = optionalBoundedDayCount(value.processingTimeMaxDays);
  const shipsWithinDays = optionalBoundedDayCount(value.shipsWithinDays);
  const shippingWeightGrams = optionalPositiveNumber(
    value.shippingWeightGrams,
    MAX_SHIPPING_WEIGHT_GRAMS,
  );
  const shippingLengthCm = optionalPositiveNumber(
    value.shippingLengthCm,
    MAX_SHIPPING_DIMENSION_CM,
  );
  const shippingWidthCm = optionalPositiveNumber(
    value.shippingWidthCm,
    MAX_SHIPPING_DIMENSION_CM,
  );
  const shippingHeightCm = optionalPositiveNumber(
    value.shippingHeightCm,
    MAX_SHIPPING_DIMENSION_CM,
  );

  if (
    title == null || title.trim().length === 0 || priceCents == null ||
    imageUrls == null || tags == null || sellerName == null ||
    sellerName.trim().length === 0
  ) {
    return fallback;
  }

  return {
    title,
    description,
    priceCents,
    imageUrls,
    category,
    tags,
    sellerName,
    capturedAt,
    listingType,
    processingTimeMinDays,
    processingTimeMaxDays,
    shipsWithinDays,
    shippingWeightGrams,
    shippingLengthCm,
    shippingWidthCm,
    shippingHeightCm,
    shippingPackageComplete:
      shippingWeightGrams !== null &&
      shippingLengthCm !== null &&
      shippingWidthCm !== null &&
      shippingHeightCm !== null,
    complete: true,
  };
}

export function historicalProcessingTimeDays(snapshot: HistoricalOrderItemSnapshot) {
  if (snapshot.listingType === "IN_STOCK") {
    const shipsWithinDays = snapshot.shipsWithinDays;
    return shipsWithinDays == null
      ? { min: null, max: null }
      : { min: shipsWithinDays, max: shipsWithinDays };
  }
  if (snapshot.listingType === "MADE_TO_ORDER") {
    return {
      min: snapshot.processingTimeMinDays,
      max: snapshot.processingTimeMaxDays,
    };
  }
  return { min: null, max: null };
}
