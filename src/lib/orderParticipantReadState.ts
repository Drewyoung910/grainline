const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const FULFILLMENT_STATUSES = new Set([
  "PENDING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "SHIPPED",
  "DELIVERED",
]);

export type OrderListCursor = Readonly<{
  createdAtEpochMillis: number;
  orderId: string;
}>;

export type BuyerOrderListRow = Readonly<{
  id: string;
  createdAt: Date;
  paidAt: Date | null;
  currency: string;
  itemsSubtotalCents: number;
  shippingTitle: string | null;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrappingPriceCents: number | null;
  sellerRefundAmountCents: number | null;
  fulfillmentStatus: "PENDING" | "READY_FOR_PICKUP" | "PICKED_UP" | "SHIPPED" | "DELIVERED";
}>;

export type SellerOrderListRow = BuyerOrderListRow & Readonly<{
  sellerNotesPresent: boolean;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerDataPurgedAt: Date | null;
  buyerDeletedAt: Date | null;
}>;

export type OrderListPage<T> = Readonly<{
  rows: T[];
  cursor: OrderListCursor | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Order list ${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`Order list ${label} is invalid`);
  }
  return value;
}

function safeInteger(value: unknown, label: string, min: number, max: number) {
  const normalized =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "string" && /^-?\d+$/.test(value)
        ? Number(value)
        : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < min || Number(normalized) > max) {
    throw new TypeError(`Order list ${label} is invalid`);
  }
  return Number(normalized);
}

function optionalSafeInteger(value: unknown, label: string, min: number, max: number) {
  return value == null ? null : safeInteger(value, label, min, max);
}

function dateFromEpochMillis(value: unknown, label: string) {
  return new Date(safeInteger(value, label, 0, MAX_EPOCH_MILLIS));
}

function optionalDateFromEpochMillis(value: unknown, label: string) {
  return value == null ? null : dateFromEpochMillis(value, label);
}

function baseBuyerRow(value: unknown): BuyerOrderListRow {
  if (!isRecord(value)) throw new TypeError("Order list row is invalid");
  const id = requiredText(value.order_id, "order id", 191);
  if (!ORDER_ID_PATTERN.test(id)) throw new TypeError("Order list order id is invalid");
  const currency = requiredText(value.currency, "currency", 3).toLowerCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("Order list currency is invalid");
  const fulfillmentStatus = requiredText(value.fulfillment_status, "fulfillment status", 32);
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw new TypeError("Order list fulfillment status is invalid");
  }

  return {
    id,
    createdAt: dateFromEpochMillis(value.created_at_epoch_millis, "created time"),
    paidAt: optionalDateFromEpochMillis(value.paid_at_epoch_millis, "paid time"),
    currency,
    itemsSubtotalCents: safeInteger(
      value.items_subtotal_cents,
      "items subtotal",
      0,
      MAX_CENTS,
    ),
    shippingTitle: optionalText(value.shipping_title, "shipping title", 200),
    shippingAmountCents: safeInteger(
      value.shipping_amount_cents,
      "shipping amount",
      0,
      MAX_CENTS,
    ),
    taxAmountCents: safeInteger(value.tax_amount_cents, "tax amount", 0, MAX_CENTS),
    giftWrappingPriceCents: optionalSafeInteger(
      value.gift_wrapping_price_cents,
      "gift wrapping price",
      0,
      MAX_CENTS,
    ),
    sellerRefundAmountCents: optionalSafeInteger(
      value.seller_refund_amount_cents,
      "seller refund amount",
      0,
      MAX_CENTS,
    ),
    fulfillmentStatus: fulfillmentStatus as BuyerOrderListRow["fulfillmentStatus"],
  };
}

export function buyerOrderListPageFromRows(
  values: unknown[],
  requestedLimit: number,
): OrderListPage<BuyerOrderListRow> {
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    throw new TypeError("Buyer Order list limit is invalid");
  }
  if (values.length > requestedLimit) throw new TypeError("Buyer Order list exceeded its limit");
  const rows = values.map(baseBuyerRow);
  const last = rows.at(-1);
  return {
    rows,
    cursor: last && rows.length === requestedLimit
      ? { createdAtEpochMillis: last.createdAt.getTime(), orderId: last.id }
      : null,
  };
}

export function sellerOrderListPageFromRows(
  values: unknown[],
  requestedLimit: number,
): OrderListPage<SellerOrderListRow> {
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
    throw new TypeError("Seller Order list limit is invalid");
  }
  if (values.length > requestedLimit) throw new TypeError("Seller Order list exceeded its limit");
  const rows = values.map((value) => {
    if (!isRecord(value)) throw new TypeError("Seller Order list row is invalid");
    if (typeof value.seller_notes_present !== "boolean") {
      throw new TypeError("Seller Order list notes flag is invalid");
    }
    return {
      ...baseBuyerRow(value),
      sellerNotesPresent: value.seller_notes_present,
      buyerName: optionalText(value.buyer_name, "buyer name", 200),
      buyerEmail: optionalText(value.buyer_email, "buyer email", 254),
      buyerDataPurgedAt: optionalDateFromEpochMillis(
        value.buyer_data_purged_at_epoch_millis,
        "buyer purge time",
      ),
      buyerDeletedAt: optionalDateFromEpochMillis(
        value.buyer_deleted_at_epoch_millis,
        "buyer deletion time",
      ),
    };
  });
  const last = rows.at(-1);
  return {
    rows,
    cursor: last && rows.length === requestedLimit
      ? { createdAtEpochMillis: last.createdAt.getTime(), orderId: last.id }
      : null,
  };
}

export function orderCountFromRows(values: unknown[], label: string) {
  if (values.length !== 1 || !isRecord(values[0])) {
    throw new TypeError(`${label} Order count row is invalid`);
  }
  return safeInteger(values[0].value, `${label} count`, 0, MAX_CENTS);
}
