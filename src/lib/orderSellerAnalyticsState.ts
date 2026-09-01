const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const FULFILLMENT_STATUSES = new Set([
  "PENDING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "SHIPPED",
  "DELIVERED",
]);

export type SellerOrderAnalyticsSummary = Readonly<{
  sellerProfileId: string;
  totalRevenueCents: number;
  totalOrders: number;
  totalBuyers: number;
  repeatBuyers: number;
  avgProcessingHours: number | null;
  cartAbandonment: number;
}>;

export type SellerOrderAnalyticsBucket = Readonly<{
  bucket: Date;
  revenue: number;
  orders: number;
}>;

export type SellerOrderTopListing = Readonly<{
  id: string;
  title: string;
  imageUrl: string | null;
  totalRevenueCents: number;
  unitsSold: number;
  avgPriceCents: number;
  viewCount: number;
  clickCount: number;
  favoritesCount: number;
  stockNotificationCount: number;
  createdAt: Date;
}>;

export type SellerRecentSale = Readonly<{
  id: string;
  createdAt: Date;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrappingPriceCents: number | null;
  currency: string;
  fulfillmentStatus: "PENDING" | "READY_FOR_PICKUP" | "PICKED_UP" | "SHIPPED" | "DELIVERED";
  firstItemPriceCents: number;
  firstItemListingSnapshot: unknown;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerDataPurgedAt: Date | null;
  buyerDeletedAt: Date | null;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} row is invalid`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, label: string, min = 0, max = MAX_CENTS) {
  const normalized =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < min || Number(normalized) > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(normalized);
}

function optionalInteger(value: unknown, label: string, min = 0, max = MAX_CENTS) {
  return value == null ? null : integer(value, label, min, max);
}

function finiteNumber(value: unknown, label: string, min = 0) {
  const normalized = typeof value === "string" ? Number(value) : value;
  if (typeof normalized !== "number" || !Number.isFinite(normalized) || normalized < min) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function text(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function id(value: unknown, label: string) {
  const result = text(value, label, 191);
  if (!ID_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function date(value: unknown, label: string) {
  return new Date(integer(value, label, 0, MAX_EPOCH_MILLIS));
}

function optionalDate(value: unknown, label: string) {
  return value == null ? null : date(value, label);
}

export function sellerOrderAnalyticsSummaryFromRows(
  values: unknown[],
): SellerOrderAnalyticsSummary | null {
  if (values.length === 0) return null;
  if (values.length !== 1) throw new TypeError("Seller Order analytics summary cardinality is invalid");
  const row = record(values[0], "Seller Order analytics summary");
  const totalBuyers = integer(row.total_buyers, "Seller Order analytics buyer count");
  const repeatBuyers = integer(row.repeat_buyers, "Seller Order analytics repeat-buyer count");
  if (repeatBuyers > totalBuyers) {
    throw new TypeError("Seller Order analytics repeat-buyer count is invalid");
  }
  return {
    sellerProfileId: id(row.seller_profile_id, "Seller Order analytics seller id"),
    totalRevenueCents: integer(row.total_revenue_cents, "Seller Order analytics revenue"),
    totalOrders: integer(row.total_orders, "Seller Order analytics order count"),
    totalBuyers,
    repeatBuyers,
    avgProcessingHours: row.avg_processing_hours == null
      ? null
      : finiteNumber(row.avg_processing_hours, "Seller Order analytics processing hours"),
    cartAbandonment: integer(row.cart_abandonment, "Seller Order analytics abandonment count"),
  };
}

export function sellerOrderAnalyticsBucketsFromRows(
  values: unknown[],
  maxRows: number,
): SellerOrderAnalyticsBucket[] {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 400) {
    throw new TypeError("Seller Order analytics bucket limit is invalid");
  }
  if (values.length > maxRows) throw new TypeError("Seller Order analytics bucket result is too large");
  let previous = -1;
  return values.map((value) => {
    const row = record(value, "Seller Order analytics bucket");
    const bucket = date(row.bucket_epoch_millis, "Seller Order analytics bucket time");
    if (bucket.getTime() <= previous) {
      throw new TypeError("Seller Order analytics buckets are not strictly ordered");
    }
    previous = bucket.getTime();
    return {
      bucket,
      revenue: integer(row.revenue_cents, "Seller Order analytics bucket revenue"),
      orders: integer(row.order_count, "Seller Order analytics bucket order count"),
    };
  });
}

export function sellerOrderTopListingsFromRows(values: unknown[]): SellerOrderTopListing[] {
  if (values.length > 8) throw new TypeError("Seller Order top-listing result is too large");
  return values.map((value) => {
    const row = record(value, "Seller Order top listing");
    return {
      id: id(row.listing_id, "Seller Order top-listing id"),
      title: text(row.title, "Seller Order top-listing title", 200),
      imageUrl: optionalText(row.image_url, "Seller Order top-listing image", 2048),
      totalRevenueCents: integer(row.total_revenue_cents, "Seller Order top-listing revenue"),
      unitsSold: integer(row.units_sold, "Seller Order top-listing units"),
      avgPriceCents: integer(row.avg_price_cents, "Seller Order top-listing average price"),
      viewCount: integer(row.view_count, "Seller Order top-listing views"),
      clickCount: integer(row.click_count, "Seller Order top-listing clicks"),
      favoritesCount: integer(row.favorite_count, "Seller Order top-listing favorites"),
      stockNotificationCount: integer(
        row.stock_notification_count,
        "Seller Order top-listing watchers",
      ),
      createdAt: date(row.listing_created_at_epoch_millis, "Seller Order top-listing creation time"),
    };
  });
}

export function sellerRecentSalesFromRows(values: unknown[]): SellerRecentSale[] {
  if (values.length > 10) throw new TypeError("Seller recent-sales result is too large");
  return values.map((value) => {
    const row = record(value, "Seller recent sale");
    const currency = text(row.currency, "Seller recent-sale currency", 3).toLowerCase();
    if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("Seller recent-sale currency is invalid");
    const fulfillmentStatus = text(
      row.fulfillment_status,
      "Seller recent-sale fulfillment status",
      32,
    );
    if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
      throw new TypeError("Seller recent-sale fulfillment status is invalid");
    }
    const buyerDataPurgedAt = optionalDate(
      row.buyer_data_purged_at_epoch_millis,
      "Seller recent-sale buyer purge time",
    );
    const buyerDeletedAt = optionalDate(
      row.buyer_deleted_at_epoch_millis,
      "Seller recent-sale buyer deletion time",
    );
    const buyerName = optionalText(row.buyer_name, "Seller recent-sale buyer name", 200);
    const buyerEmail = optionalText(row.buyer_email, "Seller recent-sale buyer email", 254);
    if ((buyerDataPurgedAt != null || buyerDeletedAt != null) && (buyerName != null || buyerEmail != null)) {
      throw new TypeError("Seller recent-sale buyer privacy state is inconsistent");
    }
    return {
      id: id(row.order_id, "Seller recent-sale Order id"),
      createdAt: date(row.created_at_epoch_millis, "Seller recent-sale creation time"),
      itemsSubtotalCents: integer(row.items_subtotal_cents, "Seller recent-sale subtotal"),
      shippingAmountCents: integer(row.shipping_amount_cents, "Seller recent-sale shipping"),
      taxAmountCents: integer(row.tax_amount_cents, "Seller recent-sale tax"),
      giftWrappingPriceCents: optionalInteger(
        row.gift_wrapping_price_cents,
        "Seller recent-sale gift wrapping",
      ),
      currency,
      fulfillmentStatus: fulfillmentStatus as SellerRecentSale["fulfillmentStatus"],
      firstItemPriceCents: integer(row.first_item_price_cents, "Seller recent-sale item price"),
      firstItemListingSnapshot: row.first_item_listing_snapshot,
      buyerName,
      buyerEmail,
      buyerDataPurgedAt,
      buyerDeletedAt,
    };
  });
}

export function sellerCompletedOrderCountFromRows(values: unknown[]) {
  if (values.length !== 1) throw new TypeError("Seller completed-Order count cardinality is invalid");
  const row = record(values[0], "Seller completed-Order count");
  return integer(row.value, "Seller completed-Order count");
}
