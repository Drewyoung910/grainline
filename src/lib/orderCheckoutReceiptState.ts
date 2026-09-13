import { participantOrderItemsFromValue, type ParticipantOrderItem } from "./orderParticipantDetailState.ts";

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;
const MAX_EPOCH_MILLIS = 253402300799999;
const MAX_CENTS = Number.MAX_SAFE_INTEGER;

export type OrderCheckoutReceipt = Readonly<{
  id: string;
  createdAt: Date;
  paidAt: Date;
  currency: string;
  itemsSubtotalCents: number;
  shippingTitle: string | null;
  shippingAmountCents: number;
  taxAmountCents: number;
  giftWrappingPriceCents: number | null;
  buyerLabel: string | null;
  items: ParticipantOrderItem[];
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Checkout receipt ${label} is invalid`);
  }
  return value;
}

function optionalText(value: unknown, label: string, maxLength: number) {
  if (value == null) return null;
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new TypeError(`Checkout receipt ${label} is invalid`);
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
    throw new TypeError(`Checkout receipt ${label} is invalid`);
  }
  return Number(normalized);
}

function dateFromEpochMillis(value: unknown, label: string) {
  return new Date(safeInteger(value, label, 0, MAX_EPOCH_MILLIS));
}

function receiptFromRow(value: unknown): OrderCheckoutReceipt {
  if (!isRecord(value)) throw new TypeError("Checkout receipt row is invalid");
  const id = requiredText(value.order_id, "order id", 191);
  if (!ID_PATTERN.test(id)) throw new TypeError("Checkout receipt order id is invalid");
  const currency = requiredText(value.currency, "currency", 3).toLowerCase();
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new TypeError("Checkout receipt currency is invalid");
  }
  const items = participantOrderItemsFromValue(value.items);
  if (items.length < 1) throw new TypeError("Checkout receipt items are invalid");
  const itemsSubtotalCents = safeInteger(
    value.items_subtotal_cents,
    "items subtotal",
    0,
    MAX_CENTS,
  );
  const projectedSubtotal = items.reduce(
    (sum, item) => sum + item.priceCents * item.quantity,
    0,
  );
  if (!Number.isSafeInteger(projectedSubtotal) || projectedSubtotal !== itemsSubtotalCents) {
    throw new TypeError("Checkout receipt item subtotal is inconsistent");
  }
  return {
    id,
    createdAt: dateFromEpochMillis(value.created_at_epoch_millis, "created time"),
    paidAt: dateFromEpochMillis(value.paid_at_epoch_millis, "paid time"),
    currency,
    itemsSubtotalCents,
    shippingTitle: optionalText(value.shipping_title, "shipping title", 200),
    shippingAmountCents: safeInteger(
      value.shipping_amount_cents,
      "shipping amount",
      0,
      MAX_CENTS,
    ),
    taxAmountCents: safeInteger(value.tax_amount_cents, "tax amount", 0, MAX_CENTS),
    giftWrappingPriceCents: value.gift_wrapping_price_cents == null
      ? null
      : safeInteger(value.gift_wrapping_price_cents, "gift wrapping amount", 0, MAX_CENTS),
    buyerLabel: optionalText(value.buyer_label, "buyer label", 254),
    items,
  };
}

export function orderCheckoutReceiptsFromRows(values: unknown[]): OrderCheckoutReceipt[] {
  if (!Array.isArray(values) || values.length > 50) {
    throw new TypeError("Checkout receipt result is invalid");
  }
  const receipts = values.map(receiptFromRow);
  const ids = new Set<string>();
  for (let index = 0; index < receipts.length; index += 1) {
    const receipt = receipts[index];
    if (ids.has(receipt.id)) throw new TypeError("Checkout receipt order is duplicated");
    ids.add(receipt.id);
    const previous = receipts[index - 1];
    if (
      previous
      && (
        previous.createdAt.getTime() < receipt.createdAt.getTime()
        || (
          previous.createdAt.getTime() === receipt.createdAt.getTime()
          && previous.id.localeCompare(receipt.id) < 0
        )
      )
    ) {
      throw new TypeError("Checkout receipt ordering is invalid");
    }
  }
  return receipts;
}
