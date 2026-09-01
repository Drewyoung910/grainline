function exactIdentifier(value: unknown, label: string) {
  if (typeof value !== "string") throw new TypeError(`${label} is invalid`);
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 191 || normalized !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function exactBoolean(value: unknown, label: string) {
  if (value !== true && value !== false) throw new TypeError(`${label} is invalid`);
  return value;
}

export function reviewEligibilityFromRows(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Review eligibility result is invalid");
  return {
    orderItemId: exactIdentifier(rows[0]?.order_item_id, "Review order item id"),
    sellerProfileId: exactIdentifier(
      rows[0]?.seller_profile_id,
      "Review seller profile id",
    ),
  };
}

export function reportTargetAccessFromRows(rows: Array<Record<string, unknown>>) {
  if (rows.length !== 1) throw new TypeError("Order report target result is invalid");
  return exactBoolean(rows[0]?.value, "Order report target result");
}

export function sellerVerificationSalesFromRows(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Seller verification sales result is invalid");
  const result = Number(rows[0]?.total_sales_cents);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError("Seller verification sales result is invalid");
  }
  return result;
}

export function listingOrderArchiveBlockedFromRows(rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Listing Order archive result is invalid");
  return exactBoolean(rows[0]?.blocked, "Listing Order archive result");
}
