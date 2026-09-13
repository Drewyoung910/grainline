export type SellerPayoutEventApplyAction =
  | "inserted"
  | "updated"
  | "already_applied"
  | "legacy_converged"
  | "stale_ignored"
  | "ignored_unknown_account";

export type SellerPayoutEventApplyResult = Readonly<{
  action: SellerPayoutEventApplyAction;
  payoutEventId: string | null;
  sellerUserId: string | null;
}>;

export type SellerPayoutLatestFailure = Readonly<{
  id: string;
  createdAt: Date;
  failureMessage: string | null;
  amountCents: number | null;
  currency: string;
}>;

export type SellerPayoutExportRow = Readonly<{
  id: string;
  sellerProfileId: string;
  stripePayoutId: string;
  status: "failed";
  amountCents: number | null;
  currency: string;
  failureCode: string | null;
  failureMessage: string | null;
  stripeEventId: string;
  eventCreatedSeconds: number;
  createdAt: Date;
  updatedAt: Date;
}>;

const APPLY_ACTIONS = new Set<SellerPayoutEventApplyAction>([
  "inserted",
  "updated",
  "already_applied",
  "legacy_converged",
  "stale_ignored",
  "ignored_unknown_account",
]);

function exactString(value: unknown, label: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Seller payout authority returned an invalid ${label}`);
  }
  return value;
}

function nullableString(value: unknown, label: string) {
  return value === null ? null : exactString(value, label);
}

function nonnegativeInteger(value: unknown, label: string) {
  if (value === null) return null;
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Seller payout authority returned an invalid ${label}`);
  }
  return parsed;
}

function eventCreatedSeconds(value: unknown) {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 253_402_300_799) {
    throw new Error("Seller payout authority returned invalid event time");
  }
  return parsed;
}

function exactDate(value: unknown, label: string) {
  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null;
  if (!parsed || Number.isNaN(parsed.getTime())) {
    throw new Error(`Seller payout authority returned an invalid ${label}`);
  }
  return parsed;
}

function exactCurrency(value: unknown) {
  const currency = exactString(value, "currency");
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error("Seller payout authority returned an invalid currency");
  }
  return currency;
}

export function sellerPayoutEventApplyFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
): SellerPayoutEventApplyResult {
  if (rows.length !== 1) {
    throw new Error("Seller payout authority returned an invalid apply row count");
  }
  const row = rows[0];
  const action = row.action;
  if (typeof action !== "string" || !APPLY_ACTIONS.has(action as SellerPayoutEventApplyAction)) {
    throw new Error("Seller payout authority returned an invalid apply action");
  }
  const payoutEventId = nullableString(row.payout_event_id, "payout event id");
  const sellerUserId = nullableString(row.seller_user_id, "seller user id");
  if (action === "ignored_unknown_account") {
    if (payoutEventId !== null || sellerUserId !== null) {
      throw new Error("Seller payout authority returned an invalid ignored result");
    }
  } else if (payoutEventId === null || sellerUserId === null) {
    throw new Error("Seller payout authority returned an incomplete apply result");
  }
  return Object.freeze({
    action: action as SellerPayoutEventApplyAction,
    payoutEventId,
    sellerUserId,
  });
}

export function sellerPayoutLatestFailureFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
): SellerPayoutLatestFailure | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller payout authority returned an invalid latest row count");
  }
  const row = rows[0];
  const seconds = eventCreatedSeconds(row.event_created_seconds);
  return Object.freeze({
    id: exactString(row.payout_event_id, "payout event id"),
    createdAt: new Date(seconds * 1000),
    failureMessage: nullableString(row.failure_message, "failure message"),
    amountCents: nonnegativeInteger(row.amount_cents, "amount"),
    currency: exactCurrency(row.currency),
  });
}

export function sellerPayoutExportRowsFromRows(
  rows: readonly Readonly<Record<string, unknown>>[],
): SellerPayoutExportRow[] {
  if (rows.length > 500) {
    throw new Error("Seller payout authority returned an oversized export page");
  }
  return rows.map((row) => {
    if (row.status !== "failed") {
      throw new Error("Seller payout authority returned an invalid status");
    }
    return Object.freeze({
      id: exactString(row.payout_event_id, "payout event id"),
      sellerProfileId: exactString(row.seller_profile_id, "seller profile id"),
      stripePayoutId: exactString(row.stripe_payout_id, "Stripe payout id"),
      status: "failed" as const,
      amountCents: nonnegativeInteger(row.amount_cents, "amount"),
      currency: exactCurrency(row.currency),
      failureCode: nullableString(row.failure_code, "failure code"),
      failureMessage: nullableString(row.failure_message, "failure message"),
      stripeEventId: exactString(row.stripe_event_id, "Stripe event id"),
      eventCreatedSeconds: eventCreatedSeconds(row.event_created_seconds),
      createdAt: exactDate(row.created_at, "created timestamp"),
      updatedAt: exactDate(row.updated_at, "updated timestamp"),
    });
  });
}
