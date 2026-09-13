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
const FULFILLMENT_METHODS = new Set(["PICKUP", "SHIPPING"]);
type StaffOrderFulfillmentStatus =
  | "PENDING"
  | "READY_FOR_PICKUP"
  | "PICKED_UP"
  | "SHIPPED"
  | "DELIVERED";
const FULFILLMENT_STATUSES: ReadonlySet<string> = new Set([
  "PENDING", "READY_FOR_PICKUP", "PICKED_UP", "SHIPPED", "DELIVERED",
]);
const REFUND_STATES = new Set<SellerRefundDisplayState>([
  "NONE", "PROCESSING", "AMBIGUOUS", "RECORDED",
]);
const CLAIM_STATES = new Set(["PENDING", "AMBIGUOUS"]);
const LISTING_TYPES = new Set(["MADE_TO_ORDER", "IN_STOCK"]);
const LABEL_STATUSES = new Set(["PURCHASED", "EXPIRED", "VOIDED"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Staff Order ${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new TypeError(`Staff Order ${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number, max: number) {
  const normalized =
    typeof value === "bigint" ? Number(value)
      : typeof value === "string" && /^-?\d+$/.test(value) ? Number(value)
      : value;
  if (!Number.isSafeInteger(normalized) || Number(normalized) < min || Number(normalized) > max) {
    throw new TypeError(`Staff Order ${label} is invalid`);
  }
  return Number(normalized);
}

function optionalInteger(value: unknown, label: string, min: number, max: number) {
  return value == null ? null : integer(value, label, min, max);
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`Staff Order ${label} is invalid`);
  return value;
}

function optionalBoolean(value: unknown, label: string) {
  if (value == null) return null;
  return boolean(value, label);
}

function date(value: unknown, label: string) {
  return new Date(integer(value, label, 0, MAX_EPOCH_MILLIS));
}

function optionalDate(value: unknown, label: string) {
  return value == null ? null : date(value, label);
}

function id(value: unknown, label: string) {
  const result = text(value, label, 191);
  if (!ID_PATTERN.test(result)) throw new TypeError(`Staff Order ${label} is invalid`);
  return result;
}

export type StaffOrderPageItem = Readonly<{ title: string; quantity: number }>;
export type StaffOrderPageEntry = Readonly<{
  id: string;
  createdAt: Date;
  currency: string;
  chargedTotalCents: number | null;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrappingPriceCents: number | null;
  quotedShippingAmountCents: number | null;
  fulfillmentStatus: StaffOrderFulfillmentStatus;
  reviewNeeded: boolean;
  reviewNote: string | null;
  buyerLabel: string;
  buyerEmail: string | null;
  sellerProfileId: string | null;
  sellerLabel: string;
  itemCount: number;
  items: StaffOrderPageItem[];
}>;

export type StaffOrderPage = Readonly<{
  totalCount: number;
  safePage: number;
  orders: StaffOrderPageEntry[];
}>;

function pageItems(value: unknown): StaffOrderPageItem[] {
  if (!Array.isArray(value) || value.length > 3) {
    throw new TypeError("Staff Order page items are invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new TypeError("Staff Order page item is invalid");
    return {
      title: text(candidate.title, "page item title", 500),
      quantity: integer(candidate.quantity, "page item quantity", 1, 10_000),
    };
  });
}

function pageEntry(value: unknown): StaffOrderPageEntry {
  if (!isRecord(value)) throw new TypeError("Staff Order page entry is invalid");
  const currency = text(value.currency, "page currency", 3).toLowerCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("Staff Order page currency is invalid");
  const fulfillmentStatus = text(value.fulfillmentStatus, "page fulfillment status", 32);
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) {
    throw new TypeError("Staff Order page fulfillment status is invalid");
  }
  const items = pageItems(value.items);
  const itemCount = integer(value.itemCount, "page item count", 0, 10_000);
  if (items.length > itemCount) throw new TypeError("Staff Order page item count is inconsistent");
  return {
    id: id(value.id, "page order id"),
    createdAt: date(value.createdAtEpochMillis, "page created time"),
    currency,
    chargedTotalCents: optionalInteger(value.chargedTotalCents, "page charged total", 0, MAX_CENTS),
    itemsSubtotalCents: integer(value.itemsSubtotalCents, "page subtotal", 0, MAX_CENTS),
    shippingAmountCents: integer(value.shippingAmountCents, "page shipping amount", 0, MAX_CENTS),
    taxAmountCents: integer(value.taxAmountCents, "page tax amount", 0, MAX_CENTS),
    giftWrappingPriceCents: optionalInteger(value.giftWrappingPriceCents, "page gift amount", 0, MAX_CENTS),
    quotedShippingAmountCents: optionalInteger(value.quotedShippingAmountCents, "page quoted shipping", 0, MAX_CENTS),
    fulfillmentStatus: fulfillmentStatus as StaffOrderFulfillmentStatus,
    reviewNeeded: boolean(value.reviewNeeded, "page review flag"),
    reviewNote: optionalText(value.reviewNote, "page review note", 10_000),
    buyerLabel: text(value.buyerLabel, "page buyer label", 254),
    buyerEmail: optionalText(value.buyerEmail, "page buyer email", 254),
    sellerProfileId: value.sellerProfileId == null ? null : id(value.sellerProfileId, "page seller id"),
    sellerLabel: text(value.sellerLabel, "page seller label", 200),
    itemCount,
    items,
  };
}

export function staffOrderPageFromRows(rows: Array<Record<string, unknown>>): StaffOrderPage | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Staff Order page returned an invalid row count");
  const row = rows[0];
  const totalCount = integer(row.total_count, "page total count", 0, Number.MAX_SAFE_INTEGER);
  const safePage = integer(row.safe_page, "safe page", 1, 1000);
  if (!Array.isArray(row.orders) || row.orders.length > 50) {
    throw new TypeError("Staff Order page rows are invalid");
  }
  const orders = row.orders.map(pageEntry);
  if (orders.length > totalCount) throw new TypeError("Staff Order page total is inconsistent");
  return { totalCount, safePage, orders };
}

function selectedVariants(value: unknown): SelectedVariantSnapshot[] | null {
  if (value == null) return null;
  if (!Array.isArray(value) || value.length > 50) return null;
  const result: SelectedVariantSnapshot[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    if (
      typeof candidate.groupName !== "string" || candidate.groupName.length < 1 || candidate.groupName.length > 50
      || typeof candidate.optionLabel !== "string" || candidate.optionLabel.length < 1 || candidate.optionLabel.length > 50
      || !Number.isSafeInteger(candidate.priceAdjustCents)
    ) return null;
    result.push({
      groupName: candidate.groupName,
      optionLabel: candidate.optionLabel,
      priceAdjustCents: Number(candidate.priceAdjustCents),
    });
  }
  return result.length > 0 ? result : null;
}

export type StaffOrderDetailItem = Readonly<{
  id: string;
  listingId: string;
  priceCents: number;
  quantity: number;
  currentListingType: "MADE_TO_ORDER" | "IN_STOCK" | null;
  listingActive: boolean;
  snapshot: HistoricalOrderItemSnapshot;
  selectedVariants: SelectedVariantSnapshot[] | null;
}>;

function detailItems(value: unknown): StaffOrderDetailItem[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new TypeError("Staff Order detail items are invalid");
  }
  return value.map((candidate) => {
    if (!isRecord(candidate)) throw new TypeError("Staff Order detail item is invalid");
    const priceCents = integer(candidate.priceCents, "detail item price", 0, MAX_CENTS);
    const currentListingType = optionalText(candidate.currentListingType, "current listing type", 32);
    if (currentListingType != null && !LISTING_TYPES.has(currentListingType)) {
      throw new TypeError("Staff Order current listing type is invalid");
    }
    return {
      id: id(candidate.id, "detail item id"),
      listingId: id(candidate.listingId, "detail listing id"),
      priceCents,
      quantity: integer(candidate.quantity, "detail item quantity", 1, 10_000),
      currentListingType: currentListingType as StaffOrderDetailItem["currentListingType"],
      listingActive: boolean(candidate.listingActive, "detail listing visibility"),
      snapshot: readHistoricalOrderItemSnapshot(candidate.listingSnapshot, priceCents),
      selectedVariants: selectedVariants(candidate.selectedVariants),
    };
  });
}

export type StaffOrderDetail = Readonly<{
  id: string;
  createdAt: Date;
  paidAt: Date | null;
  currency: string;
  chargedTotalCents: number | null;
  itemsSubtotalCents: number;
  shippingTitle: string | null;
  shippingAmountCents: number;
  taxAmountCents: number;
  fulfillmentMethod: "PICKUP" | "SHIPPING" | null;
  fulfillmentStatus: StaffOrderFulfillmentStatus;
  trackingCarrier: string | null;
  trackingNumber: string | null;
  pickupReadyAt: Date | null;
  pickedUpAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
  estimatedDeliveryDate: Date | null;
  processingDeadline: Date | null;
  shippingCarrier: string | null;
  shippingService: string | null;
  reviewNeeded: boolean;
  reviewNote: string | null;
  giftNote: string | null;
  giftWrapping: boolean;
  giftWrappingPriceCents: number | null;
  buyerDataPurgedAt: Date | null;
  buyerId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  quotedShippingAmountCents: number | null;
  quotedToCity: string | null;
  quotedToState: string | null;
  quotedToPostalCode: string | null;
  quotedToCountry: string | null;
  quotedUseCalculatedShipping: boolean | null;
  sellerProfileId: string | null;
  sellerDisplayName: string;
  sellerUserId: string | null;
  sellerUserName: string | null;
  sellerUserEmail: string | null;
  sellerRefundState: SellerRefundDisplayState;
  sellerRefundId: string | null;
  sellerRefundAmountCents: number | null;
  refundClaimState: "PENDING" | "AMBIGUOUS" | null;
  labelStatus: "PURCHASED" | "EXPIRED" | "VOIDED" | null;
  labelClawbackStatus: string | null;
  items: StaffOrderDetailItem[];
}>;

export function staffOrderDetailFromRows(rows: Array<Record<string, unknown>>): StaffOrderDetail | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new TypeError("Staff Order detail returned an invalid row count");
  const row = rows[0];
  const currency = text(row.currency, "detail currency", 3).toLowerCase();
  if (!CURRENCY_PATTERN.test(currency)) throw new TypeError("Staff Order detail currency is invalid");
  const fulfillmentMethod = optionalText(row.fulfillment_method, "fulfillment method", 32);
  if (fulfillmentMethod != null && !FULFILLMENT_METHODS.has(fulfillmentMethod)) {
    throw new TypeError("Staff Order fulfillment method is invalid");
  }
  const fulfillmentStatus = text(row.fulfillment_status, "fulfillment status", 32);
  if (!FULFILLMENT_STATUSES.has(fulfillmentStatus)) throw new TypeError("Staff Order fulfillment status is invalid");
  const refundState = text(row.seller_refund_state, "refund state", 32);
  if (!REFUND_STATES.has(refundState as SellerRefundDisplayState)) throw new TypeError("Staff Order refund state is invalid");
  const claimState = optionalText(row.refund_claim_state, "refund claim state", 32);
  if (claimState != null && !CLAIM_STATES.has(claimState)) throw new TypeError("Staff Order refund claim state is invalid");
  const labelStatus = optionalText(row.label_status, "label status", 32);
  if (labelStatus != null && !LABEL_STATUSES.has(labelStatus)) throw new TypeError("Staff Order label status is invalid");
  const sellerRefundId = optionalText(row.seller_refund_id, "provider refund id", 255);
  const sellerRefundAmountCents = optionalInteger(row.seller_refund_amount_cents, "refund amount", 0, MAX_CENTS);
  if (refundState !== "RECORDED" && (sellerRefundId != null || sellerRefundAmountCents != null)) {
    throw new TypeError("Staff Order refund identity is inconsistent");
  }
  if (refundState === "RECORDED" && sellerRefundId == null) {
    throw new TypeError("Staff Order refund identity is inconsistent");
  }
  const result: StaffOrderDetail = {
    id: id(row.order_id, "detail order id"),
    createdAt: date(row.created_at_epoch_millis, "detail created time"),
    paidAt: optionalDate(row.paid_at_epoch_millis, "detail paid time"),
    currency,
    chargedTotalCents: optionalInteger(row.charged_total_cents, "detail charged total", 0, MAX_CENTS),
    itemsSubtotalCents: integer(row.items_subtotal_cents, "detail subtotal", 0, MAX_CENTS),
    shippingTitle: optionalText(row.shipping_title, "shipping title", 200),
    shippingAmountCents: integer(row.shipping_amount_cents, "shipping amount", 0, MAX_CENTS),
    taxAmountCents: integer(row.tax_amount_cents, "tax amount", 0, MAX_CENTS),
    fulfillmentMethod: fulfillmentMethod as StaffOrderDetail["fulfillmentMethod"],
    fulfillmentStatus: fulfillmentStatus as StaffOrderFulfillmentStatus,
    trackingCarrier: optionalText(row.tracking_carrier, "tracking carrier", 100),
    trackingNumber: optionalText(row.tracking_number, "tracking number", 100),
    pickupReadyAt: optionalDate(row.pickup_ready_at_epoch_millis, "pickup ready time"),
    pickedUpAt: optionalDate(row.picked_up_at_epoch_millis, "picked up time"),
    shippedAt: optionalDate(row.shipped_at_epoch_millis, "shipped time"),
    deliveredAt: optionalDate(row.delivered_at_epoch_millis, "delivered time"),
    estimatedDeliveryDate: optionalDate(row.estimated_delivery_at_epoch_millis, "estimated delivery time"),
    processingDeadline: optionalDate(row.processing_deadline_epoch_millis, "processing deadline"),
    shippingCarrier: optionalText(row.shipping_carrier, "shipping carrier", 100),
    shippingService: optionalText(row.shipping_service, "shipping service", 100),
    reviewNeeded: boolean(row.review_needed, "review flag"),
    reviewNote: optionalText(row.review_note, "review note", 10_000),
    giftNote: optionalText(row.gift_note, "gift note", 500),
    giftWrapping: boolean(row.gift_wrapping, "gift wrapping flag"),
    giftWrappingPriceCents: optionalInteger(row.gift_wrapping_price_cents, "gift amount", 0, MAX_CENTS),
    buyerDataPurgedAt: optionalDate(row.buyer_data_purged_at_epoch_millis, "buyer purge time"),
    buyerId: row.buyer_id == null ? null : id(row.buyer_id, "buyer id"),
    buyerName: optionalText(row.buyer_name, "buyer name", 200),
    buyerEmail: optionalText(row.buyer_email, "buyer email", 254),
    shipToLine1: optionalText(row.ship_to_line_1, "address line 1", 200),
    shipToLine2: optionalText(row.ship_to_line_2, "address line 2", 200),
    shipToCity: optionalText(row.ship_to_city, "address city", 100),
    shipToState: optionalText(row.ship_to_state, "address state", 50),
    shipToPostalCode: optionalText(row.ship_to_postal_code, "address postal code", 20),
    shipToCountry: optionalText(row.ship_to_country, "address country", 2),
    quotedShippingAmountCents: optionalInteger(row.quoted_shipping_amount_cents, "quoted shipping", 0, MAX_CENTS),
    quotedToCity: optionalText(row.quoted_to_city, "quoted city", 100),
    quotedToState: optionalText(row.quoted_to_state, "quoted state", 50),
    quotedToPostalCode: optionalText(row.quoted_to_postal_code, "quoted postal code", 20),
    quotedToCountry: optionalText(row.quoted_to_country, "quoted country", 2),
    quotedUseCalculatedShipping: optionalBoolean(row.quoted_use_calculated_shipping, "quoted calculation flag"),
    sellerProfileId: row.seller_profile_id == null ? null : id(row.seller_profile_id, "seller id"),
    sellerDisplayName: text(row.seller_display_name, "seller display name", 200),
    sellerUserId: row.seller_user_id == null ? null : id(row.seller_user_id, "seller user id"),
    sellerUserName: optionalText(row.seller_user_name, "seller user name", 200),
    sellerUserEmail: optionalText(row.seller_user_email, "seller user email", 254),
    sellerRefundState: refundState as SellerRefundDisplayState,
    sellerRefundId,
    sellerRefundAmountCents,
    refundClaimState: claimState as StaffOrderDetail["refundClaimState"],
    labelStatus: labelStatus as StaffOrderDetail["labelStatus"],
    labelClawbackStatus: optionalText(row.label_clawback_status, "label clawback status", 50),
    items: detailItems(row.items),
  };
  if (
    result.buyerDataPurgedAt !== null
    && [
      result.buyerName,
      result.buyerEmail,
      result.giftNote,
      result.shipToLine1,
      result.shipToLine2,
      result.shipToCity,
      result.shipToState,
      result.shipToPostalCode,
      result.shipToCountry,
      result.quotedToCity,
      result.quotedToState,
      result.quotedToPostalCode,
      result.quotedToCountry,
    ].some((value) => value !== null)
  ) {
    throw new TypeError("Staff Order purged buyer data is inconsistent");
  }
  return result;
}
