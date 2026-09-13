export type PublicSellerOrderStats = Readonly<{
  soldCount: number;
  shippedCount: number;
  avgShipDays: number | null;
}>;

export type PublicMarketplaceListingMetrics = Readonly<{
  totalViews: number;
  totalClicks: number;
  totalOrders: number;
}>;

function safeInteger(value: unknown, label: string) {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(number);
}

function finiteNumberOrNull(value: unknown, label: string) {
  if (value == null) return null;
  const number = typeof value === "string" ? Number(value) : value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return number;
}

export function fulfilledOrderCountFromRows(rows: Array<Record<string, unknown>>) {
  if (rows.length !== 1) throw new TypeError("Public fulfilled Order count is invalid");
  return safeInteger(rows[0]?.value, "Public fulfilled Order count");
}

export function publicSellerOrderStatsFromRows(
  rows: Array<Record<string, unknown>>,
): PublicSellerOrderStats | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Public seller Order stats are invalid");
  return Object.freeze({
    soldCount: safeInteger(rows[0]?.sold_count, "Public seller sold count"),
    shippedCount: safeInteger(rows[0]?.shipped_count, "Public seller shipped count"),
    avgShipDays: finiteNumberOrNull(rows[0]?.avg_ship_days, "Public seller ship days"),
  });
}

export function publicListingOrderCountsFromRows(
  rows: Array<Record<string, unknown>>,
) {
  const counts = new Map<string, bigint>();
  for (const row of rows) {
    if (
      typeof row.listing_id !== "string"
      || row.listing_id.length < 1
      || row.listing_id.length > 191
      || counts.has(row.listing_id)
    ) {
      throw new TypeError("Public listing Order count identity is invalid");
    }
    counts.set(
      row.listing_id,
      BigInt(safeInteger(row.order_count, "Public listing Order count")),
    );
  }
  return counts;
}

export function publicMarketplaceListingMetricsFromRows(
  rows: Array<Record<string, unknown>>,
): PublicMarketplaceListingMetrics {
  if (rows.length !== 1) {
    throw new TypeError("Public marketplace listing metrics are invalid");
  }
  return Object.freeze({
    totalViews: safeInteger(rows[0]?.total_views, "Public marketplace views"),
    totalClicks: safeInteger(rows[0]?.total_clicks, "Public marketplace clicks"),
    totalOrders: safeInteger(rows[0]?.total_orders, "Public marketplace Orders"),
  });
}
