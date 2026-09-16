import { readHistoricalOrderItemSnapshot } from "./orderItemSnapshot.ts";

export type OrderCheckoutPostpaymentItem = Readonly<{
  id: string;
  listingId: string;
  quantity: number;
  priceCents: number;
  currentStockQuantity: number | null;
  snapshot: ReturnType<typeof readHistoricalOrderItemSnapshot>;
}>;

export type OrderCheckoutPostpaymentProjection = Readonly<{
  orderId: string;
  buyerId: string;
  buyerName: string | null;
  buyerEmail: string;
  sellerProfileId: string;
  sellerUserId: string;
  sellerDisplayName: string;
  sellerEmail: string;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  currency: string;
  estimatedDeliveryDate: Date | null;
  processingDeadline: Date | null;
  shipToLine1: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  isFirstLegitimateSale: boolean;
  items: readonly OrderCheckoutPostpaymentItem[];
}>;

export type OrderCheckoutPostpaymentResult =
  | Readonly<{ outcome: "blocked"; orderId: string; projection: null }>
  | Readonly<{
      outcome: "ready";
      orderId: string;
      projection: OrderCheckoutPostpaymentProjection;
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactRecord(value: unknown, keys: readonly string[], label: string) {
  if (!isRecord(value)) {
    throw new TypeError(`checkout post-payment authority returned invalid ${label}`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`checkout post-payment authority returned invalid ${label} keys`);
  }
  return value;
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength) {
    throw new TypeError(`checkout post-payment authority returned invalid ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string, maxLength: number) {
  return value === null ? null : requiredString(value, field, maxLength);
}

function nonnegativeInteger(value: unknown, field: string) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`checkout post-payment authority returned invalid ${field}`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string) {
  const parsed = nonnegativeInteger(value, field);
  if (parsed === 0) {
    throw new TypeError(`checkout post-payment authority returned invalid ${field}`);
  }
  return parsed;
}

function nullableDate(value: unknown, field: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new TypeError(`checkout post-payment authority returned invalid ${field}`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`checkout post-payment authority returned invalid ${field}`);
  }
  return date;
}

const PROJECTION_KEYS = [
  "orderId", "buyerId", "buyerName", "buyerEmail", "sellerProfileId",
  "sellerUserId", "sellerDisplayName", "sellerEmail", "itemsSubtotalCents",
  "shippingAmountCents", "taxAmountCents", "giftWrapping",
  "giftWrappingPriceCents", "currency", "estimatedDeliveryDate",
  "processingDeadline", "shipToLine1", "shipToCity", "shipToState",
  "shipToPostalCode", "isFirstLegitimateSale", "items",
] as const;

const ITEM_KEYS = [
  "id", "listingId", "quantity", "priceCents", "listingSnapshot",
  "currentStockQuantity",
] as const;

function parseItems(value: unknown): readonly OrderCheckoutPostpaymentItem[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) {
    throw new TypeError("checkout post-payment authority returned invalid items");
  }
  const itemIds = new Set<string>();
  const parsed = value.map((raw, index) => {
    const item = exactRecord(raw, ITEM_KEYS, `item ${index}`);
    const id = requiredString(item.id, `item ${index} id`, 191);
    if (itemIds.has(id)) {
      throw new TypeError("checkout post-payment authority returned duplicate item id");
    }
    itemIds.add(id);
    const priceCents = nonnegativeInteger(item.priceCents, `item ${index} price`);
    const snapshot = readHistoricalOrderItemSnapshot(item.listingSnapshot, priceCents);
    if (!snapshot.complete) {
      throw new TypeError("checkout post-payment authority returned incomplete item snapshot");
    }
    const currentStockQuantity = item.currentStockQuantity === null
      ? null
      : nonnegativeInteger(item.currentStockQuantity, `item ${index} stock`);
    return Object.freeze({
      id,
      listingId: requiredString(item.listingId, `item ${index} listing id`, 191),
      quantity: positiveInteger(item.quantity, `item ${index} quantity`),
      priceCents,
      currentStockQuantity,
      snapshot: Object.freeze(snapshot),
    });
  });
  return Object.freeze(parsed);
}

export function checkoutPostpaymentResultFromRows(
  rows: readonly Record<string, unknown>[],
): OrderCheckoutPostpaymentResult {
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("checkout post-payment authority returned invalid cardinality");
  }
  const orderId = requiredString(row.order_id, "order id", 191);
  if (row.outcome === "blocked") {
    if (row.projection !== null) {
      throw new TypeError("checkout post-payment authority returned inconsistent blocked result");
    }
    return Object.freeze({ outcome: "blocked", orderId, projection: null });
  }
  if (row.outcome !== "ready") {
    throw new TypeError("checkout post-payment authority returned invalid outcome");
  }
  const projection = exactRecord(row.projection, PROJECTION_KEYS, "projection");
  const projectedOrderId = requiredString(projection.orderId, "projected order id", 191);
  if (projectedOrderId !== orderId) {
    throw new TypeError("checkout post-payment authority returned mismatched order id");
  }
  if (typeof projection.giftWrapping !== "boolean" || typeof projection.isFirstLegitimateSale !== "boolean") {
    throw new TypeError("checkout post-payment authority returned invalid boolean projection");
  }
  const giftWrappingPriceCents = projection.giftWrappingPriceCents === null
    ? null
    : nonnegativeInteger(projection.giftWrappingPriceCents, "gift-wrapping price");
  const currency = requiredString(projection.currency, "currency", 3);
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new TypeError("checkout post-payment authority returned invalid currency");
  }
  const result: OrderCheckoutPostpaymentProjection = Object.freeze({
    orderId,
    buyerId: requiredString(projection.buyerId, "buyer id", 191),
    buyerName: nullableString(projection.buyerName, "buyer name", 100),
    buyerEmail: requiredString(projection.buyerEmail, "buyer email", 254),
    sellerProfileId: requiredString(projection.sellerProfileId, "seller profile id", 191),
    sellerUserId: requiredString(projection.sellerUserId, "seller user id", 191),
    sellerDisplayName: requiredString(projection.sellerDisplayName, "seller display name", 100),
    sellerEmail: requiredString(projection.sellerEmail, "seller email", 254),
    itemsSubtotalCents: nonnegativeInteger(projection.itemsSubtotalCents, "items subtotal"),
    shippingAmountCents: nonnegativeInteger(projection.shippingAmountCents, "shipping amount"),
    taxAmountCents: nonnegativeInteger(projection.taxAmountCents, "tax amount"),
    giftWrapping: projection.giftWrapping,
    giftWrappingPriceCents,
    currency,
    estimatedDeliveryDate: nullableDate(projection.estimatedDeliveryDate, "estimated delivery date"),
    processingDeadline: nullableDate(projection.processingDeadline, "processing deadline"),
    shipToLine1: nullableString(projection.shipToLine1, "shipping line 1", 200),
    shipToCity: nullableString(projection.shipToCity, "shipping city", 100),
    shipToState: nullableString(projection.shipToState, "shipping state", 50),
    shipToPostalCode: nullableString(projection.shipToPostalCode, "shipping postal code", 20),
    isFirstLegitimateSale: projection.isFirstLegitimateSale,
    items: parseItems(projection.items),
  });
  return Object.freeze({ outcome: "ready", orderId, projection: result });
}
