import type { SellerRefundDisplayState } from "./refundLockState.ts";
import {
  readHistoricalOrderItemSnapshot,
  type HistoricalOrderItemSnapshot,
} from "./orderItemSnapshot.ts";
import type { SelectedVariantSnapshot } from "./listingVariants.ts";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const REFUND_STATES = new Set<SellerRefundDisplayState>([
  "NONE", "PROCESSING", "AMBIGUOUS", "RECORDED",
]);
const FULFILLMENT_METHODS = new Set(["PICKUP", "SHIPPING"]);
const FULFILLMENT_STATUSES = new Set([
  "PENDING", "READY_FOR_PICKUP", "PICKED_UP", "SHIPPED", "DELIVERED",
]);
const ITEM_KEYS = Object.freeze([
  "listingId", "listingSnapshot", "priceCents", "quantity", "selectedVariants",
]);
const BUYER_KEYS = Object.freeze([
  "buyerDataPurgedAtEpochMillis", "buyerEmail", "buyerName", "createdAtEpochMillis",
  "currency", "deliveredAtEpochMillis", "fulfillmentMethod", "fulfillmentStatus",
  "giftNote", "giftWrapping", "giftWrappingPriceCents", "id", "items",
  "itemsSubtotalCents", "paidAtEpochMillis", "sellerRefundAmountCents",
  "sellerRefundState", "shippedAtEpochMillis", "shippingAmountCents", "shippingTitle",
  "shipToCity", "shipToCountry", "shipToLine1", "shipToLine2", "shipToPostalCode",
  "shipToState", "taxAmountCents", "trackingCarrier", "trackingNumber",
].sort());
const SELLER_KEYS = Object.freeze([
  "createdAtEpochMillis", "currency", "deliveredAtEpochMillis", "fulfillmentMethod",
  "fulfillmentStatus", "id", "items", "itemsSubtotalCents", "paidAtEpochMillis",
  "sellerRefundAmountCents", "sellerRefundState", "shippedAtEpochMillis",
  "shippingAmountCents", "shippingTitle", "taxAmountCents", "trackingCarrier",
  "trackingNumber",
].sort());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string) {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`Order export ${label} has an invalid shape`);
  }
}

function text(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Order export ${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`Order export ${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number) {
  const normalized = typeof value === "bigint" ? Number(value)
    : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value)
    : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < min || Number(normalized) > max) {
    throw new TypeError(`Order export ${label} is invalid`);
  }
  return Number(normalized);
}

function optionalInteger(value: unknown, label: string, min: number, max: number) {
  return value == null ? null : integer(value, label, min, max);
}

function date(value: unknown, label: string) {
  return new Date(integer(value, label, 0, MAX_EPOCH_MILLIS));
}

function optionalDate(value: unknown, label: string) {
  return value == null ? null : date(value, label);
}

function id(value: unknown, label: string) {
  const normalized = text(value, label, 191);
  if (!ID_PATTERN.test(normalized)) throw new TypeError(`Order export ${label} is invalid`);
  return normalized;
}

function bool(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`Order export ${label} is invalid`);
  return value;
}

function selectedVariants(value: unknown): SelectedVariantSnapshot[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: SelectedVariantSnapshot[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    const groupName = candidate.groupName;
    const optionLabel = candidate.optionLabel;
    const priceAdjustCents = candidate.priceAdjustCents;
    if (
      typeof groupName !== "string" || groupName.length < 1 || groupName.length > 50
      || typeof optionLabel !== "string" || optionLabel.length < 1 || optionLabel.length > 50
      || !Number.isSafeInteger(priceAdjustCents)
      || Number(priceAdjustCents) < -10_000_000
      || Number(priceAdjustCents) > 10_000_000
    ) return null;
    result.push({ groupName, optionLabel, priceAdjustCents: Number(priceAdjustCents) });
  }
  return result.length > 0 ? result : null;
}

export type ParticipantOrderExportItem = Readonly<{
  listingId: string;
  quantity: number;
  priceCents: number;
  selectedVariants: SelectedVariantSnapshot[] | null;
  listingSnapshot: HistoricalOrderItemSnapshot;
}>;

function items(value: unknown): ParticipantOrderExportItem[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Order export items are invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new TypeError("Order export item is invalid");
    exactKeys(candidate, ITEM_KEYS, "item");
    const priceCents = integer(candidate.priceCents, "item price", 0, MAX_CENTS);
    return {
      listingId: id(candidate.listingId, "listing id"),
      quantity: integer(candidate.quantity, "item quantity", 1, 10_000),
      priceCents,
      selectedVariants: selectedVariants(candidate.selectedVariants),
      listingSnapshot: readHistoricalOrderItemSnapshot(candidate.listingSnapshot, priceCents),
    };
  });
}

type OrderExportBase = Readonly<{
  id: string;
  createdAt: Date;
  paidAt: Date | null;
  currency: string;
  itemsSubtotalCents: number;
  shippingTitle: string | null;
  shippingAmountCents: number;
  taxAmountCents: number;
  fulfillmentMethod: "PICKUP" | "SHIPPING" | null;
  fulfillmentStatus: "PENDING" | "READY_FOR_PICKUP" | "PICKED_UP" | "SHIPPED" | "DELIVERED";
  trackingCarrier: string | null;
  trackingNumber: string | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  sellerRefundState: SellerRefundDisplayState;
  sellerRefundAmountCents: number | null;
  items: ParticipantOrderExportItem[];
}>;

export type BuyerOrderExport = OrderExportBase & Readonly<{
  buyerEmail: string | null;
  buyerName: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  giftNote: string | null;
  giftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  buyerDataPurgedAt: Date | null;
}>;

export type SellerOrderExport = OrderExportBase;
export type OrderExportCursor = Readonly<{
  createdAtEpochMillis: number;
  orderId: string;
}>;

function base(value: Record<string, unknown>): OrderExportBase {
  const currency = text(value.currency, "currency", 3).toLowerCase();
  if (!/^[a-z]{3}$/.test(currency)) throw new TypeError("Order export currency is invalid");
  const fulfillmentMethod = optionalText(value.fulfillmentMethod, "fulfillment method", 32);
  if (fulfillmentMethod != null && !FULFILLMENT_METHODS.has(fulfillmentMethod)) {
    throw new TypeError("Order export fulfillment method is invalid");
  }
  const fulfillmentStatus = text(value.fulfillmentStatus, "fulfillment status", 32);
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw new TypeError("Order export fulfillment status is invalid");
  }
  const refundState = text(value.sellerRefundState, "refund state", 32);
  if (!REFUND_STATES.has(refundState as SellerRefundDisplayState)) {
    throw new TypeError("Order export refund state is invalid");
  }
  const refundAmount = optionalInteger(value.sellerRefundAmountCents, "refund amount", 0, MAX_CENTS);
  if (refundState !== "RECORDED" && refundAmount != null) {
    throw new TypeError("Order export refund amount is inconsistent");
  }
  return {
    id: id(value.id, "order id"),
    createdAt: date(value.createdAtEpochMillis, "created time"),
    paidAt: optionalDate(value.paidAtEpochMillis, "paid time"),
    currency,
    itemsSubtotalCents: integer(value.itemsSubtotalCents, "subtotal", 0, MAX_CENTS),
    shippingTitle: optionalText(value.shippingTitle, "shipping title", 200),
    shippingAmountCents: integer(value.shippingAmountCents, "shipping amount", 0, MAX_CENTS),
    taxAmountCents: integer(value.taxAmountCents, "tax amount", 0, MAX_CENTS),
    fulfillmentMethod: fulfillmentMethod as OrderExportBase["fulfillmentMethod"],
    fulfillmentStatus: fulfillmentStatus as OrderExportBase["fulfillmentStatus"],
    trackingCarrier: optionalText(value.trackingCarrier, "tracking carrier", 100),
    trackingNumber: optionalText(value.trackingNumber, "tracking number", 100),
    shippedAt: optionalDate(value.shippedAtEpochMillis, "shipped time"),
    deliveredAt: optionalDate(value.deliveredAtEpochMillis, "delivered time"),
    sellerRefundState: refundState as SellerRefundDisplayState,
    sellerRefundAmountCents: refundAmount,
    items: items(value.items),
  };
}

function buyer(value: unknown): BuyerOrderExport {
  if (!isRecord(value)) throw new TypeError("Buyer Order export row is invalid");
  exactKeys(value, BUYER_KEYS, "buyer row");
  const result: BuyerOrderExport = {
    ...base(value),
    buyerEmail: optionalText(value.buyerEmail, "buyer email", 254),
    buyerName: optionalText(value.buyerName, "buyer name", 200),
    shipToLine1: optionalText(value.shipToLine1, "address line 1", 200),
    shipToLine2: optionalText(value.shipToLine2, "address line 2", 200),
    shipToCity: optionalText(value.shipToCity, "address city", 100),
    shipToState: optionalText(value.shipToState, "address state", 50),
    shipToPostalCode: optionalText(value.shipToPostalCode, "address postal code", 20),
    shipToCountry: optionalText(value.shipToCountry, "address country", 2),
    giftNote: optionalText(value.giftNote, "gift note", 500),
    giftWrapping: bool(value.giftWrapping, "gift wrapping flag"),
    giftWrappingPriceCents: optionalInteger(value.giftWrappingPriceCents, "gift amount", 0, MAX_CENTS),
    buyerDataPurgedAt: optionalDate(value.buyerDataPurgedAtEpochMillis, "buyer purge time"),
  };
  if (
    result.buyerDataPurgedAt !== null
    && [result.buyerEmail, result.buyerName, result.shipToLine1, result.shipToLine2,
      result.shipToCity, result.shipToState, result.shipToPostalCode,
      result.shipToCountry, result.giftNote].some((entry) => entry !== null)
  ) throw new TypeError("Buyer Order export retained purged PII");
  return result;
}

function seller(value: unknown): SellerOrderExport {
  if (!isRecord(value)) throw new TypeError("Seller Order export row is invalid");
  exactKeys(value, SELLER_KEYS, "seller row");
  return base(value);
}

function cursor(row: Record<string, unknown>, parsed: OrderExportBase): OrderExportCursor {
  const createdAtEpochMillis = integer(
    row.created_at_epoch_millis,
    "cursor time",
    0,
    MAX_EPOCH_MILLIS,
  );
  const orderId = id(row.order_id, "cursor order id");
  if (createdAtEpochMillis !== parsed.createdAt.getTime() || orderId !== parsed.id) {
    throw new TypeError("Order export cursor does not match its row");
  }
  return { createdAtEpochMillis, orderId };
}

export function buyerOrderExportPageFromRows(rows: Array<Record<string, unknown>>, limit: number) {
  if (limit < 1 || limit > 25 || rows.length > limit) {
    throw new TypeError("Buyer Order export page size is invalid");
  }
  const values = rows.map((row) => buyer(row.order_data));
  return {
    values,
    cursor: rows.length === 0 ? null : cursor(rows.at(-1)!, values.at(-1)!),
  };
}

export function sellerOrderExportPageFromRows(rows: Array<Record<string, unknown>>, limit: number) {
  if (limit < 1 || limit > 25 || rows.length > limit) {
    throw new TypeError("Seller Order export page size is invalid");
  }
  const values = rows.map((row) => seller(row.order_data));
  return {
    values,
    cursor: rows.length === 0 ? null : cursor(rows.at(-1)!, values.at(-1)!),
  };
}
