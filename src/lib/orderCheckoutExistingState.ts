export type OrderCheckoutExistingResult =
  | Readonly<{
      outcome: "absent";
      orderId: null;
      retryReason: null;
      sellerUserIds: readonly [];
    }>
  | Readonly<{
      outcome: "complete" | "processing";
      orderId: string;
      retryReason: null;
      sellerUserIds: readonly [];
    }>
  | Readonly<{
      outcome: "retry";
      orderId: string;
      retryReason: string;
      sellerUserIds: readonly string[];
    }>;

function nullableString(value: unknown, field: string, maxLength: number) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`checkout existing authority returned invalid ${field}`);
  }
  return value;
}

function exactSellerIds(value: unknown) {
  if (
    !Array.isArray(value)
    || value.length > 1
    || value.some((item) => typeof item !== "string" || item.length === 0 || item.length > 191)
    || new Set(value).size !== value.length
  ) {
    throw new TypeError("checkout existing authority returned invalid seller ids");
  }
  return Object.freeze([...value] as string[]);
}

export function checkoutExistingResultFromRows(
  rows: readonly Record<string, unknown>[],
): OrderCheckoutExistingResult {
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("checkout existing authority returned invalid cardinality");
  }
  if (
    row.outcome !== "absent"
    && row.outcome !== "complete"
    && row.outcome !== "retry"
    && row.outcome !== "processing"
  ) {
    throw new TypeError("checkout existing authority returned invalid outcome");
  }
  const orderId = nullableString(row.order_id, "order id", 191);
  const retryReason = nullableString(row.retry_reason, "retry reason", 1000);
  const sellerUserIds = exactSellerIds(row.seller_user_ids);
  if (
    (row.outcome === "absent" && (
      orderId !== null || retryReason !== null || sellerUserIds.length !== 0
    ))
    || (row.outcome !== "absent" && orderId === null)
    || (row.outcome === "retry" && retryReason === null)
    || (row.outcome !== "retry" && (
      retryReason !== null || sellerUserIds.length !== 0
    ))
  ) {
    throw new TypeError("checkout existing authority returned inconsistent result");
  }
  if (row.outcome === "absent") {
    return Object.freeze({
      outcome: "absent" as const,
      orderId: null,
      retryReason: null,
      sellerUserIds: Object.freeze([]) as readonly [],
    });
  }
  if (row.outcome === "retry") {
    if (orderId === null || retryReason === null) {
      throw new TypeError("checkout existing authority returned inconsistent retry result");
    }
    return Object.freeze({
      outcome: "retry" as const,
      orderId,
      retryReason,
      sellerUserIds,
    });
  }
  if (orderId === null) {
    throw new TypeError("checkout existing authority returned inconsistent Order result");
  }
  return Object.freeze({
    outcome: row.outcome,
    orderId,
    retryReason: null,
    sellerUserIds: Object.freeze([]) as readonly [],
  });
}
