import type { SellerRefundDisplayState } from "./refundLockState.ts";
import {
  readHistoricalOrderItemSnapshot,
  type HistoricalOrderItemSnapshot,
} from "./orderItemSnapshot.ts";
import type { SelectedVariantSnapshot } from "./listingVariants.ts";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;
const REFUND_STATES = new Set<SellerRefundDisplayState>([
  "NONE",
  "PROCESSING",
  "AMBIGUOUS",
  "RECORDED",
]);
const FULFILLMENT_METHODS = new Set(["PICKUP", "SHIPPING"]);
const FULFILLMENT_STATUSES = new Set([
  "PENDING",
  "READY_FOR_PICKUP",
  "PICKED_UP",
  "SHIPPED",
  "DELIVERED",
]);
const LABEL_STATUSES = new Set(["PURCHASED", "EXPIRED", "VOIDED"]);

export type ParticipantOrderItem = Readonly<{
  id: string;
  listingId: string;
  priceCents: number;
  quantity: number;
  listingActive: boolean;
  snapshot: HistoricalOrderItemSnapshot;
  selectedVariants: SelectedVariantSnapshot[] | null;
}>;

type ParticipantOrderDetailBase = Readonly<{
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
  pickupReadyAt: Date | null;
  pickedUpAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  estimatedDeliveryDate: Date | null;
  shippingCarrier: string | null;
  shippingService: string | null;
  reviewNeeded: boolean;
  giftNote: string | null;
  giftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  buyerDataPurgedAt: Date | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  sellerRefundState: SellerRefundDisplayState;
  sellerRefundAmountCents: number | null;
  items: ParticipantOrderItem[];
}>;

export type BuyerOrderDetail = ParticipantOrderDetailBase & Readonly<{
  sellerUserId: string | null;
}>;

export type SellerOrderDetail = ParticipantOrderDetailBase & Readonly<{
  processingDeadline: Date | null;
  deauthorizedReviewHold: boolean;
  buyerId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  buyerDeletedAt: Date | null;
  sellerNotes: string | null;
  labelStatus: "PURCHASED" | "EXPIRED" | "VOIDED" | null;
  labelUrl: string | null;
  labelCarrier: string | null;
  labelTrackingNumber: string | null;
  labelPurchasedAt: Date | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Order detail ${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`Order detail ${label} is invalid`);
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
    throw new TypeError(`Order detail ${label} is invalid`);
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

function requiredBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`Order detail ${label} is invalid`);
  return value;
}

function selectedVariantsFromValue(value: unknown): SelectedVariantSnapshot[] | null {
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
    ) {
      return null;
    }
    result.push({ groupName, optionLabel, priceAdjustCents: Number(priceAdjustCents) });
  }
  return result.length > 0 ? result : null;
}

function itemsFromValue(value: unknown): ParticipantOrderItem[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Order detail items are invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new TypeError("Order detail item is invalid");
    const id = requiredText(candidate.id, "item id", 191);
    const listingId = requiredText(candidate.listingId, "listing id", 191);
    if (!ID_PATTERN.test(id) || !ID_PATTERN.test(listingId)) {
      throw new TypeError("Order detail item identity is invalid");
    }
    const priceCents = safeInteger(candidate.priceCents, "item price", 0, MAX_CENTS);
    return {
      id,
      listingId,
      priceCents,
      quantity: safeInteger(candidate.quantity, "item quantity", 1, 10_000),
      listingActive: requiredBoolean(candidate.listingActive, "listing visibility"),
      snapshot: readHistoricalOrderItemSnapshot(candidate.listingSnapshot, priceCents),
      selectedVariants: selectedVariantsFromValue(candidate.selectedVariants),
    };
  });
}

function baseDetail(value: Record<string, unknown>): ParticipantOrderDetailBase {
  const id = requiredText(value.order_id, "order id", 191);
  if (!ID_PATTERN.test(id)) throw new TypeError("Order detail order id is invalid");
  const currency = requiredText(value.currency, "currency", 3).toLowerCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("Order detail currency is invalid");
  const fulfillmentMethod = optionalText(value.fulfillment_method, "fulfillment method", 32);
  if (fulfillmentMethod != null && !FULFILLMENT_METHODS.has(fulfillmentMethod)) {
    throw new TypeError("Order detail fulfillment method is invalid");
  }
  const fulfillmentStatus = requiredText(value.fulfillment_status, "fulfillment status", 32);
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw new TypeError("Order detail fulfillment status is invalid");
  }
  const sellerRefundState = requiredText(value.seller_refund_state, "refund state", 32);
  if (!REFUND_STATES.has(sellerRefundState as SellerRefundDisplayState)) {
    throw new TypeError("Order detail refund state is invalid");
  }
  const sellerRefundAmountCents = optionalSafeInteger(
    value.seller_refund_amount_cents,
    "refund amount",
    0,
    MAX_CENTS,
  );
  if (sellerRefundState !== "RECORDED" && sellerRefundAmountCents != null) {
    throw new TypeError("Order detail refund amount is inconsistent");
  }

  const detail = {
    id,
    createdAt: dateFromEpochMillis(value.created_at_epoch_millis, "created time"),
    paidAt: optionalDateFromEpochMillis(value.paid_at_epoch_millis, "paid time"),
    currency,
    itemsSubtotalCents: safeInteger(value.items_subtotal_cents, "items subtotal", 0, MAX_CENTS),
    shippingTitle: optionalText(value.shipping_title, "shipping title", 200),
    shippingAmountCents: safeInteger(value.shipping_amount_cents, "shipping amount", 0, MAX_CENTS),
    taxAmountCents: safeInteger(value.tax_amount_cents, "tax amount", 0, MAX_CENTS),
    fulfillmentMethod: fulfillmentMethod as ParticipantOrderDetailBase["fulfillmentMethod"],
    fulfillmentStatus: fulfillmentStatus as ParticipantOrderDetailBase["fulfillmentStatus"],
    trackingCarrier: optionalText(value.tracking_carrier, "tracking carrier", 100),
    trackingNumber: optionalText(value.tracking_number, "tracking number", 100),
    pickupReadyAt: optionalDateFromEpochMillis(value.pickup_ready_at_epoch_millis, "pickup ready time"),
    pickedUpAt: optionalDateFromEpochMillis(value.picked_up_at_epoch_millis, "picked up time"),
    shippedAt: optionalDateFromEpochMillis(value.shipped_at_epoch_millis, "shipped time"),
    deliveredAt: optionalDateFromEpochMillis(value.delivered_at_epoch_millis, "delivered time"),
    estimatedDeliveryDate: optionalDateFromEpochMillis(
      value.estimated_delivery_at_epoch_millis,
      "estimated delivery time",
    ),
    shippingCarrier: optionalText(value.shipping_carrier, "shipping carrier", 100),
    shippingService: optionalText(value.shipping_service, "shipping service", 100),
    reviewNeeded: requiredBoolean(value.review_needed, "review flag"),
    giftNote: optionalText(value.gift_note, "gift note", 500),
    giftWrapping: requiredBoolean(value.gift_wrapping, "gift wrapping flag"),
    giftWrappingPriceCents: optionalSafeInteger(
      value.gift_wrapping_price_cents,
      "gift wrapping price",
      0,
      MAX_CENTS,
    ),
    buyerDataPurgedAt: optionalDateFromEpochMillis(
      value.buyer_data_purged_at_epoch_millis,
      "buyer purge time",
    ),
    shipToLine1: optionalText(value.ship_to_line_1, "ship-to line 1", 200),
    shipToLine2: optionalText(value.ship_to_line_2, "ship-to line 2", 200),
    shipToCity: optionalText(value.ship_to_city, "ship-to city", 100),
    shipToState: optionalText(value.ship_to_state, "ship-to state", 50),
    shipToPostalCode: optionalText(value.ship_to_postal_code, "ship-to postal code", 20),
    shipToCountry: optionalText(value.ship_to_country, "ship-to country", 2),
    sellerRefundState: sellerRefundState as SellerRefundDisplayState,
    sellerRefundAmountCents,
    items: itemsFromValue(value.items),
  };
  if (
    detail.buyerDataPurgedAt != null
    && (
      detail.giftNote != null
      || detail.shipToLine1 != null
      || detail.shipToLine2 != null
      || detail.shipToCity != null
      || detail.shipToState != null
      || detail.shipToPostalCode != null
      || detail.shipToCountry != null
    )
  ) {
    throw new TypeError("Order detail buyer purge boundary is inconsistent");
  }
  return detail;
}

function exactlyOneOrNone(values: unknown[], label: string) {
  if (values.length === 0) return null;
  if (values.length !== 1 || !isRecord(values[0])) {
    throw new TypeError(`${label} Order detail row is invalid`);
  }
  return values[0];
}

export function buyerOrderDetailFromRows(values: unknown[]): BuyerOrderDetail | null {
  const value = exactlyOneOrNone(values, "Buyer");
  if (!value) return null;
  const sellerUserId = optionalText(value.seller_user_id, "seller user id", 191);
  if (sellerUserId != null && !ID_PATTERN.test(sellerUserId)) {
    throw new TypeError("Order detail seller user id is invalid");
  }
  return { ...baseDetail(value), sellerUserId };
}

export function sellerOrderDetailFromRows(values: unknown[]): SellerOrderDetail | null {
  const value = exactlyOneOrNone(values, "Seller");
  if (!value) return null;
  const buyerId = optionalText(value.buyer_id, "buyer id", 191);
  if (buyerId != null && !ID_PATTERN.test(buyerId)) {
    throw new TypeError("Order detail buyer id is invalid");
  }
  const labelStatus = optionalText(value.label_status, "label status", 32);
  if (labelStatus != null && !LABEL_STATUSES.has(labelStatus)) {
    throw new TypeError("Order detail label status is invalid");
  }
  const detail = {
    ...baseDetail(value),
    processingDeadline: optionalDateFromEpochMillis(
      value.processing_deadline_epoch_millis,
      "processing deadline",
    ),
    deauthorizedReviewHold: requiredBoolean(
      value.deauthorized_review_hold,
      "deauthorized review hold",
    ),
    buyerId,
    buyerName: optionalText(value.buyer_name, "buyer name", 200),
    buyerEmail: optionalText(value.buyer_email, "buyer email", 254),
    buyerDeletedAt: optionalDateFromEpochMillis(
      value.buyer_deleted_at_epoch_millis,
      "buyer deletion time",
    ),
    sellerNotes: optionalText(value.seller_notes, "seller notes", 2000),
    labelStatus: labelStatus as SellerOrderDetail["labelStatus"],
    labelUrl: optionalText(value.label_url, "label URL", 2048),
    labelCarrier: optionalText(value.label_carrier, "label carrier", 100),
    labelTrackingNumber: optionalText(value.label_tracking_number, "label tracking number", 100),
    labelPurchasedAt: optionalDateFromEpochMillis(
      value.label_purchased_at_epoch_millis,
      "label purchase time",
    ),
  };
  if (
    (detail.buyerDataPurgedAt != null || detail.buyerDeletedAt != null)
    && (
      detail.buyerId != null
      || detail.buyerName != null
      || detail.buyerEmail != null
    )
  ) {
    throw new TypeError("Order detail buyer identity boundary is inconsistent");
  }
  if (detail.buyerDataPurgedAt != null && detail.sellerNotes != null) {
    throw new TypeError("Order detail seller note purge boundary is inconsistent");
  }
  if (
    detail.labelStatus !== "PURCHASED"
    && (
      detail.labelUrl != null
      || detail.labelCarrier != null
      || detail.labelTrackingNumber != null
      || detail.labelPurchasedAt != null
    )
  ) {
    throw new TypeError("Order detail label boundary is inconsistent");
  }
  return detail;
}
