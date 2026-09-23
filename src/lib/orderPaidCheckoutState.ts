export type PaidCheckoutAuthorityResult = Readonly<{
  outcome: "created" | "replayed";
  orderId: string;
  invalidReason: string | null;
  invalidSellerUserIds: readonly string[];
  listingVisibilityChanged: boolean;
}>;

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`paid checkout authority returned invalid ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string) {
  return value === null ? null : requiredString(value, field);
}

function exactStringArray(value: unknown) {
  if (
    !Array.isArray(value)
    || value.length > 1
    || value.some((item) => typeof item !== "string" || item.length === 0)
    || new Set(value).size !== value.length
  ) {
    throw new TypeError("paid checkout authority returned invalid seller ids");
  }
  return Object.freeze([...value]);
}

export function paidCheckoutAuthorityResultFromRows(
  rows: readonly Record<string, unknown>[],
): PaidCheckoutAuthorityResult {
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("paid checkout authority returned invalid cardinality");
  }
  if (row.outcome !== "created" && row.outcome !== "replayed") {
    throw new TypeError("paid checkout authority returned invalid outcome");
  }
  if (typeof row.listing_visibility_changed !== "boolean") {
    throw new TypeError("paid checkout authority returned invalid visibility state");
  }
  const orderId = requiredString(row.order_id, "order id");
  const invalidReason = nullableString(row.invalid_reason, "invalid reason");
  const invalidSellerUserIds = exactStringArray(row.invalid_seller_user_ids);
  if (
    (invalidSellerUserIds.length > 0 && invalidReason === null)
    || (row.outcome === "replayed" && (
      invalidReason !== null
      || invalidSellerUserIds.length !== 0
      || row.listing_visibility_changed
    ))
  ) {
    throw new TypeError("paid checkout authority returned an inconsistent result");
  }
  return Object.freeze({
    outcome: row.outcome,
    orderId,
    invalidReason,
    invalidSellerUserIds,
    listingVisibilityChanged: row.listing_visibility_changed,
  });
}
