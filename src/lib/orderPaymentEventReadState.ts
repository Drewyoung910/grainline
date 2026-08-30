export type OrderPaymentRefundOutcome = Readonly<{
  eventType: "REFUND";
  amountCents: number | null;
  currency: string;
  status: string | null;
  createdAt: Date;
}>;

export type BuyerOrderPaymentHistory = Readonly<{
  eventType: "REFUND";
  amountCents: number | null;
  currency: string;
  status: string | null;
  createdAt: Date;
}>;

export type SellerOrderPaymentHistory = BuyerOrderPaymentHistory & Readonly<{
  reason: string | null;
}>;

export type OrderPaymentStaffTimelineEvent = Readonly<{
  id: string;
  stripeEventId: string;
  stripeObjectId: string;
  stripeObjectType: string;
  eventType: "REFUND" | "DISPUTE";
  amountCents: number | null;
  currency: string;
  status: string | null;
  reason: string | null;
  description: string | null;
  refundAccounting: Readonly<{
    transferReversalId: string | null;
    transferReversalAmountCents: number | null;
    platformFundedRefundCents: number | null;
    originalTransferAmountCents: number | null;
  }> | null;
  createdAt: Date;
}>;

export type OrderPaymentExportCursor = Readonly<{
  paymentEventId: string;
  createdAtEpochMillis: bigint;
}>;

export type BuyerOrderPaymentHistoryPage = Readonly<{
  rows: ReadonlyArray<Readonly<{
    orderId: string;
    value: BuyerOrderPaymentHistory;
  }>>;
  cursor: OrderPaymentExportCursor | null;
}>;

export type SellerOrderPaymentHistoryPage = Readonly<{
  rows: ReadonlyArray<Readonly<{
    orderId: string;
    value: SellerOrderPaymentHistory;
  }>>;
  cursor: OrderPaymentExportCursor | null;
}>;

function exactString(value: unknown, label: string, max = 191) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > max
    || value.trim() !== value
  ) {
    throw new Error(`Order payment read authority returned invalid ${label}`);
  }
  return value;
}

function nullableString(value: unknown, label: string, max: number) {
  return value === null ? null : exactString(value, label, max);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (value === null) return null;
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Order payment read authority returned invalid ${label}`);
  }
  return parsed;
}

function exactCurrency(value: unknown) {
  const currency = exactString(value, "currency", 3);
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error("Order payment read authority returned invalid currency");
  }
  return currency;
}

function exactEventType(value: unknown): "REFUND" | "DISPUTE" {
  if (value !== "REFUND" && value !== "DISPUTE") {
    throw new Error("Order payment read authority returned invalid event type");
  }
  return value;
}

function epochMillis(value: unknown) {
  let parsed: bigint;
  try {
    parsed = typeof value === "bigint" ? value : BigInt(String(value));
  } catch {
    throw new Error("Order payment read authority returned invalid event time");
  }
  if (parsed < 0n || parsed > 253_402_300_799_999n) {
    throw new Error("Order payment read authority returned invalid event time");
  }
  return parsed;
}

function exactDateFromEpochMillis(value: unknown) {
  const epoch = epochMillis(value);
  const date = new Date(Number(epoch));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Order payment read authority returned invalid event time");
  }
  return { date, epoch };
}

function paymentHistoryValue(
  row: Readonly<Record<string, unknown>>,
): BuyerOrderPaymentHistory {
  if (exactEventType(row.event_type) !== "REFUND") {
    throw new Error("Order payment export returned a non-refund event");
  }
  return Object.freeze({
    eventType: "REFUND" as const,
    amountCents: nonnegativeInteger(row.amount_cents, "amount"),
    currency: exactCurrency(row.currency),
    status: nullableString(row.status, "status", 100),
    createdAt: exactDateFromEpochMillis(row.created_at_epoch_millis).date,
  });
}

export function orderPaymentRefundOutcomesFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
) {
  if (rows.length > 100) {
    throw new Error("Order payment outcome authority returned too many rows");
  }
  const outcomes = new Map<string, OrderPaymentRefundOutcome>();
  for (const row of rows) {
    const orderId = exactString(row.order_id, "order id");
    if (outcomes.has(orderId)) {
      throw new Error("Order payment outcome authority returned a duplicate order");
    }
    outcomes.set(orderId, Object.freeze({
      eventType: "REFUND" as const,
      amountCents: nonnegativeInteger(row.amount_cents, "amount"),
      currency: exactCurrency(row.currency),
      status: nullableString(row.status, "status", 100),
      createdAt: exactDateFromEpochMillis(row.created_at_epoch_millis).date,
    }));
  }
  return outcomes;
}

export function buyerOrderPaymentHistoryPageFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  limit: number,
): BuyerOrderPaymentHistoryPage {
  if (rows.length > limit || limit < 1 || limit > 500) {
    throw new Error("Buyer payment export returned an invalid page size");
  }
  const values = rows.map((row) => Object.freeze({
    orderId: exactString(row.order_id, "order id"),
    value: paymentHistoryValue(row),
  }));
  const last = rows.at(-1);
  return Object.freeze({
    rows: Object.freeze(values),
    cursor: last
      ? Object.freeze({
          paymentEventId: exactString(last.payment_event_id, "payment event cursor"),
          createdAtEpochMillis: epochMillis(last.created_at_epoch_millis),
        })
      : null,
  });
}

export function sellerOrderPaymentHistoryPageFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
  limit: number,
): SellerOrderPaymentHistoryPage {
  if (rows.length > limit || limit < 1 || limit > 500) {
    throw new Error("Seller payment export returned an invalid page size");
  }
  const values = rows.map((row) => Object.freeze({
    orderId: exactString(row.order_id, "order id"),
    value: Object.freeze({
      ...paymentHistoryValue(row),
      reason: nullableString(row.reason, "reason", 255),
    }),
  }));
  const last = rows.at(-1);
  return Object.freeze({
    rows: Object.freeze(values),
    cursor: last
      ? Object.freeze({
          paymentEventId: exactString(last.payment_event_id, "payment event cursor"),
          createdAtEpochMillis: epochMillis(last.created_at_epoch_millis),
        })
      : null,
  });
}

function nullableAccountingInteger(value: unknown, label: string) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^[0-9]{1,10}$/.test(value)) {
    throw new Error(`Order payment staff timeline returned invalid ${label}`);
  }
  return nonnegativeInteger(value, label);
}

export function orderPaymentStaffTimelineFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
): OrderPaymentStaffTimelineEvent[] {
  if (rows.length > 25) {
    throw new Error("Order payment staff timeline returned too many rows");
  }
  return rows.map((row) => {
    const transferReversalId = nullableString(
      row.transfer_reversal_id,
      "transfer reversal id",
      255,
    );
    const transferReversalAmountCents = nullableAccountingInteger(
      row.transfer_reversal_amount_cents,
      "transfer reversal amount",
    );
    const platformFundedRefundCents = nullableAccountingInteger(
      row.platform_funded_refund_cents,
      "platform-funded refund amount",
    );
    const originalTransferAmountCents = nullableAccountingInteger(
      row.original_transfer_amount_cents,
      "original transfer amount",
    );
    const hasAccounting = transferReversalId !== null
      || transferReversalAmountCents !== null
      || platformFundedRefundCents !== null
      || originalTransferAmountCents !== null;

    return Object.freeze({
      id: exactString(row.payment_event_id, "payment event id"),
      stripeEventId: exactString(row.stripe_event_id, "Stripe event id", 255),
      stripeObjectId: exactString(row.stripe_object_id, "Stripe object id", 255),
      stripeObjectType: exactString(row.stripe_object_type, "Stripe object type", 100),
      eventType: exactEventType(row.event_type),
      amountCents: nonnegativeInteger(row.amount_cents, "amount"),
      currency: exactCurrency(row.currency),
      status: nullableString(row.status, "status", 100),
      reason: nullableString(row.reason, "reason", 255),
      description: nullableString(row.description, "description", 5000),
      refundAccounting: hasAccounting
        ? Object.freeze({
            transferReversalId,
            transferReversalAmountCents,
            platformFundedRefundCents,
            originalTransferAmountCents,
          })
        : null,
      createdAt: exactDateFromEpochMillis(row.created_at_epoch_millis).date,
    });
  });
}

export function groupBuyerPaymentHistory(
  rows: readonly Readonly<{ orderId: string; value: BuyerOrderPaymentHistory }>[],
) {
  const grouped = new Map<string, BuyerOrderPaymentHistory[]>();
  for (const row of rows) {
    const events = grouped.get(row.orderId) ?? [];
    events.push(row.value);
    grouped.set(row.orderId, events);
  }
  return grouped;
}

export function groupSellerPaymentHistory(
  rows: readonly Readonly<{ orderId: string; value: SellerOrderPaymentHistory }>[],
) {
  const grouped = new Map<string, SellerOrderPaymentHistory[]>();
  for (const row of rows) {
    const events = grouped.get(row.orderId) ?? [];
    events.push(row.value);
    grouped.set(row.orderId, events);
  }
  return grouped;
}
