const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

export type OrderSellerMetricsFacts = Readonly<{
  sellerProfileId: string;
  completedOrderCount: number;
  totalSalesCents: number;
  shippedCount: number;
  onTimeCount: number;
}>;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("Order seller-metrics row is invalid");
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, max = MAX_CENTS) {
  const normalized =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 0 || Number(normalized) > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(normalized);
}

export function orderSellerMetricsFactsFromRows(
  rows: unknown[],
): OrderSellerMetricsFacts | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError("Order seller-metrics cardinality is invalid");
  }
  const row = record(rows[0]);
  if (typeof row.seller_profile_id !== "string" || !ID_PATTERN.test(row.seller_profile_id)) {
    throw new TypeError("Order seller-metrics seller id is invalid");
  }
  const shippedCount = integer(row.shipped_count, "Order seller-metrics shipped count");
  const onTimeCount = integer(row.on_time_count, "Order seller-metrics on-time count");
  if (onTimeCount > shippedCount) {
    throw new TypeError("Order seller-metrics shipping counts are inconsistent");
  }
  return {
    sellerProfileId: row.seller_profile_id,
    completedOrderCount: integer(
      row.completed_order_count,
      "Order seller-metrics completed count",
    ),
    totalSalesCents: integer(row.total_sales_cents, "Order seller-metrics sales"),
    shippedCount,
    onTimeCount,
  };
}
