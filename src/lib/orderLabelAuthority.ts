import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { normalizeCurrencyCode } from "@/lib/money";

type LabelAuthorityClient = Pick<typeof prisma, "$queryRaw">;

const ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const CLAIM_PATTERN = /^order-label-claim:[0-9a-f-]{36}$/;
const HTTPS_URL = /^https:\/\/\S+$/;

export type OrderLabelConflictReason =
  | "unpaid"
  | "refunded"
  | "open_dispute"
  | "active_case"
  | "seller_deauthorized"
  | "state_changed"
  | "label_purchased"
  | "label_claim_active"
  | "address_missing"
  | "package_missing"
  | "rate_required"
  | "rate_expired"
  | "stale_claim"
  | "label_unavailable";

export type LabelAddress = {
  name: string | null;
  street1: string;
  street2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export type SellerLabelPreflightResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderLabelConflictReason }
  | {
      outcome: "ready";
      orderId: string;
      sellerUserId: string;
      currency: string;
      storedRateObjectId: string | null;
      storedRateAmountCents: number | null;
      storedRateUsable: boolean;
      packageSource: "CHECKOUT_SNAPSHOT" | "LEGACY_LIVE";
      packageWeightGrams: number;
      packageLengthCm: number;
      packageWidthCm: number;
      packageHeightCm: number;
      shipFrom: LabelAddress;
      shipTo: LabelAddress;
    };

export type FixedLabelRate = {
  objectId: string;
  amountCents: number;
  currency: string;
  label: string;
  carrier?: string | null;
  service?: string | null;
  estDays?: number | null;
};

export type SellerLabelClaimResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderLabelConflictReason }
  | {
      outcome: "claimed";
      orderId: string;
      claimId: string;
      claimGeneration: number;
      rateObjectId: string;
      amountCents: number;
      currency: string;
    };

export type SellerLabelProviderRecordResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: OrderLabelConflictReason }
  | { outcome: "released"; orderId: string }
  | { outcome: "ambiguous"; orderId: string; claimId: string; claimGeneration: number }
  | {
      outcome: "recorded";
      orderId: string;
      claimId: string;
      claimGeneration: number;
      clawbackGeneration: number;
      clawbackStatus: "NOT_REQUIRED" | "RETRYING" | "MANUAL_REVIEW" | "REVERSED";
      stripeTransferId: string | null;
      transactionId: string;
      rateObjectId: string;
      amountCents: number;
      currency: string;
      carrier: string;
      trackingNumber: string | null;
      labelPurchasedAt: string;
      auditLogId: string;
      buyerUserId: string | null;
      buyerName: string | null;
      buyerEmail: string | null;
      estimatedDeliveryDate: string | null;
    };

export type LabelClawbackClaim = {
  orderId: string;
  claimId: string;
  claimGeneration: number;
  clawbackGeneration: number;
  stripeTransferId: string;
  transactionId: string;
  rateObjectId: string;
  amountCents: number;
  currency: string;
  attemptCount: number;
};

export type SellerLabelDownloadResult =
  | { outcome: "unauthorized" }
  | { outcome: "conflict"; reason: "label_unavailable" }
  | {
      outcome: "ready";
      orderId: string;
      transactionId: string;
      rateObjectId: string;
      amountCents: number;
      currency: string;
    };

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function id(value: unknown, label: string, max = 255) {
  const result = string(value, label, max);
  if (!ID_PATTERN.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function nullableString(value: unknown, label: string, max: number) {
  return value == null ? null : string(value, label, max);
}

function integer(value: unknown, label: string, min: number, max: number) {
  const numeric = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(numeric) || Number(numeric) < min || Number(numeric) > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(numeric);
}

function positiveGeneration(value: unknown, label: string) {
  return integer(value, label, 1, Number.MAX_SAFE_INTEGER);
}

function money(value: unknown, label: string) {
  return integer(value, label, 0, 500_000);
}

function positiveMeasurement(value: unknown, label: string, max: number) {
  const numeric = typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)
    ? Number(value)
    : value;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0 || numeric > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return numeric;
}

function currency(value: unknown, label: string) {
  const result = normalizeCurrencyCode(string(value, label, 3)).toLowerCase();
  if (!/^[a-z]{3}$/.test(result)) throw new TypeError(`${label} is invalid`);
  return result;
}

function conflict(value: unknown, label: string): { outcome: "conflict"; reason: OrderLabelConflictReason } {
  const row = record(value, label);
  const reason = string(row.reason, `${label} reason`, 64) as OrderLabelConflictReason;
  const allowed: readonly OrderLabelConflictReason[] = [
    "unpaid", "refunded", "open_dispute", "active_case", "seller_deauthorized",
    "state_changed", "label_purchased", "label_claim_active", "address_missing",
    "package_missing", "rate_required", "rate_expired", "stale_claim", "label_unavailable",
  ];
  if (!allowed.includes(reason)) throw new TypeError(`${label} reason is unrecognized`);
  return { outcome: "conflict", reason };
}

function nullableAuthority(value: unknown) {
  return value == null ? { outcome: "unauthorized" } as const : null;
}

function address(value: unknown, label: string): LabelAddress {
  const row = record(value, label);
  return {
    name: nullableString(row.name, `${label} name`, 200),
    street1: string(row.street1, `${label} street`, 200),
    street2: nullableString(row.street2, `${label} street 2`, 200),
    city: string(row.city, `${label} city`, 100),
    state: string(row.state, `${label} state`, 50),
    zip: string(row.zip, `${label} postal`, 20),
    country: string(row.country, `${label} country`, 2),
  };
}

async function oneResult(client: LabelAuthorityClient, query: Prisma.Sql, label: string) {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(query);
  if (rows.length !== 1) throw new TypeError(`${label} returned invalid cardinality`);
  return rows[0].result;
}

export async function sellerLabelPreflight(
  input: { actorUserId: string; orderId: string },
  client: LabelAuthorityClient = prisma,
): Promise<SellerLabelPreflightResult> {
  const actor = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = id(input.orderId, "Order label Order id", 191);
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_seller_label_preflight(${actor}::text, ${orderId}::text) AS result
  `, "Order label preflight");
  const unauthorized = nullableAuthority(value);
  if (unauthorized) return unauthorized;
  const row = record(value, "Order label preflight");
  if (row.outcome === "conflict") return conflict(row, "Order label preflight");
  if (row.outcome !== "ready") throw new TypeError("Order label preflight outcome is invalid");
  const source = string(row.packageSource, "Order label package source", 32);
  if (source !== "CHECKOUT_SNAPSHOT" && source !== "LEGACY_LIVE") {
    throw new TypeError("Order label package source is invalid");
  }
  return {
    outcome: "ready",
    orderId: id(row.orderId, "Order label Order id", 191),
    sellerUserId: id(row.sellerUserId, "Order label seller user", 191),
    currency: currency(row.currency, "Order label currency"),
    storedRateObjectId: row.storedRateObjectId == null
      ? null : id(row.storedRateObjectId, "Order label stored rate"),
    storedRateAmountCents: row.storedRateAmountCents == null
      ? null : money(row.storedRateAmountCents, "Order label stored amount"),
    storedRateUsable: row.storedRateUsable === true,
    packageSource: source,
    packageWeightGrams: positiveMeasurement(
      row.packageWeightGrams,
      "Order label package weight",
      500_000,
    ),
    packageLengthCm: positiveMeasurement(
      row.packageLengthCm,
      "Order label package length",
      1_000,
    ),
    packageWidthCm: positiveMeasurement(
      row.packageWidthCm,
      "Order label package width",
      1_000,
    ),
    packageHeightCm: positiveMeasurement(
      row.packageHeightCm,
      "Order label package height",
      1_000,
    ),
    shipFrom: address(row.shipFrom, "Order label ship-from"),
    shipTo: address(row.shipTo, "Order label ship-to"),
  };
}

export async function replaceSellerLabelQuote(
  input: { actorUserId: string; orderId: string; shipmentId: string; rates: FixedLabelRate[] },
  client: LabelAuthorityClient = prisma,
) {
  const actor = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = id(input.orderId, "Order label Order id", 191);
  const shipmentId = id(input.shipmentId, "Order label shipment id");
  const encoded = JSON.stringify(input.rates);
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_seller_label_quote_replace(
      ${actor}::text, ${orderId}::text, ${shipmentId}::text, ${encoded}::jsonb
    ) AS result
  `, "Order label quote replace");
  const unauthorized = nullableAuthority(value);
  if (unauthorized) return unauthorized;
  const row = record(value, "Order label quote replace");
  if (row.outcome === "conflict") return conflict(row, "Order label quote replace");
  if (row.outcome !== "changed" || row.orderId !== orderId || row.shipmentId !== shipmentId) {
    throw new TypeError("Order label quote replace result is invalid");
  }
  return { outcome: "changed" as const, orderId, shipmentId };
}

export async function claimSellerLabelPurchase(
  input: { actorUserId: string; orderId: string; rateObjectId?: string | null },
  client: LabelAuthorityClient = prisma,
): Promise<SellerLabelClaimResult> {
  const actor = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = id(input.orderId, "Order label Order id", 191);
  const rateId = input.rateObjectId == null ? null : id(input.rateObjectId, "Order label rate id");
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_seller_label_claim(
      ${actor}::text, ${orderId}::text, ${rateId}::text
    ) AS result
  `, "Order label claim");
  const unauthorized = nullableAuthority(value);
  if (unauthorized) return unauthorized;
  const row = record(value, "Order label claim");
  if (row.outcome === "conflict") return conflict(row, "Order label claim");
  if (row.outcome !== "claimed" || row.orderId !== orderId) {
    throw new TypeError("Order label claim result is invalid");
  }
  const claimId = string(row.claimId, "Order label claim id", 255);
  if (!CLAIM_PATTERN.test(claimId)) throw new TypeError("Order label claim id is invalid");
  return {
    outcome: "claimed", orderId, claimId,
    claimGeneration: positiveGeneration(row.claimGeneration, "Order label claim generation"),
    rateObjectId: id(row.rateObjectId, "Order label rate id"),
    amountCents: money(row.amountCents, "Order label amount"),
    currency: currency(row.currency, "Order label currency"),
  };
}

export async function recordSellerLabelProviderResult(
  input: {
    actorUserId: string; orderId: string; claimId: string; claimGeneration: number;
    outcome: "REJECTED" | "AMBIGUOUS" | "SUCCESS";
    transactionId?: string | null; labelUrl?: string | null; rateObjectId?: string | null;
    amountCents?: number | null; currency?: string | null; carrier?: string | null;
    trackingNumber?: string | null; errorSummary?: string | null;
  },
  client: LabelAuthorityClient = prisma,
): Promise<SellerLabelProviderRecordResult> {
  const actor = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = id(input.orderId, "Order label Order id", 191);
  if (!CLAIM_PATTERN.test(input.claimId)) throw new TypeError("Order label claim id is invalid");
  const generation = positiveGeneration(input.claimGeneration, "Order label claim generation");
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_seller_label_provider_record(
      ${actor}::text, ${orderId}::text, ${input.claimId}::text, ${BigInt(generation)}::bigint,
      ${input.outcome}::text, ${input.transactionId ?? null}::text,
      ${input.labelUrl ?? null}::text, ${input.rateObjectId ?? null}::text,
      ${input.amountCents ?? null}::integer, ${input.currency ?? null}::text,
      ${input.carrier ?? null}::text, ${input.trackingNumber ?? null}::text,
      ${input.errorSummary ?? null}::text
    ) AS result
  `, "Order label provider record");
  const unauthorized = nullableAuthority(value);
  if (unauthorized) return unauthorized;
  const row = record(value, "Order label provider record");
  if (row.outcome === "conflict") return conflict(row, "Order label provider record");
  if (row.orderId !== orderId) throw new TypeError("Order label provider record changed identity");
  if (row.outcome === "released") return { outcome: "released", orderId };
  if (row.outcome === "ambiguous") {
    return {
      outcome: "ambiguous", orderId,
      claimId: string(row.claimId, "Order label claim id", 255),
      claimGeneration: positiveGeneration(row.claimGeneration, "Order label claim generation"),
    };
  }
  if (row.outcome !== "recorded") throw new TypeError("Order label provider outcome is invalid");
  const clawbackStatus = string(row.clawbackStatus, "Order label clawback status", 32);
  if (!["NOT_REQUIRED", "RETRYING", "MANUAL_REVIEW", "REVERSED"].includes(clawbackStatus)) {
    throw new TypeError("Order label clawback status is invalid");
  }
  return {
    outcome: "recorded", orderId,
    claimId: string(row.claimId, "Order label claim id", 255),
    claimGeneration: positiveGeneration(row.claimGeneration, "Order label claim generation"),
    clawbackGeneration: integer(row.clawbackGeneration, "Order label clawback generation", 0, Number.MAX_SAFE_INTEGER),
    clawbackStatus: clawbackStatus as "NOT_REQUIRED" | "RETRYING" | "MANUAL_REVIEW" | "REVERSED",
    stripeTransferId: nullableString(row.stripeTransferId, "Order Stripe transfer", 255),
    transactionId: id(row.transactionId, "Order Shippo transaction"),
    rateObjectId: id(row.rateObjectId, "Order label rate"),
    amountCents: money(row.amountCents, "Order label amount"),
    currency: currency(row.currency, "Order label currency"),
    carrier: string(row.carrier, "Order label carrier", 100),
    trackingNumber: nullableString(row.trackingNumber, "Order label tracking", 100),
    labelPurchasedAt: string(row.labelPurchasedAt, "Order label purchased at", 64),
    auditLogId: id(row.auditLogId, "Order label audit id"),
    buyerUserId: nullableString(row.buyerUserId, "Order buyer user", 191),
    buyerName: nullableString(row.buyerName, "Order buyer name", 200),
    buyerEmail: nullableString(row.buyerEmail, "Order buyer email", 254),
    estimatedDeliveryDate: nullableString(row.estimatedDeliveryDate, "Order delivery date", 64),
  };
}

export async function finalizeLabelClawback(
  input: {
    orderId: string; claimId: string; claimGeneration: number; clawbackGeneration: number;
    outcome: "SUCCESS" | "FAILED"; reversalId?: string | null; errorSummary?: string | null;
  },
  client: LabelAuthorityClient = prisma,
) {
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_label_clawback_finalize(
      ${id(input.orderId, "Order label Order id", 191)}::text,
      ${input.claimId}::text, ${BigInt(positiveGeneration(input.claimGeneration, "Order label claim generation"))}::bigint,
      ${BigInt(positiveGeneration(input.clawbackGeneration, "Order label clawback generation"))}::bigint,
      ${input.outcome}::text, ${input.reversalId ?? null}::text, ${input.errorSummary ?? null}::text
    ) AS result
  `, "Order label clawback finalize");
  return record(value, "Order label clawback finalize");
}

export async function claimLabelClawbackBatch(
  limit: number,
  client: LabelAuthorityClient = prisma,
): Promise<LabelClawbackClaim[]> {
  const bounded = integer(limit, "Order label clawback batch limit", 1, 50);
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_label_clawback_claim_batch(${bounded}::integer) AS result
  `, "Order label clawback batch");
  if (!Array.isArray(value)) throw new TypeError("Order label clawback batch is invalid");
  return value.map((entry) => {
    const row = record(entry, "Order label clawback claim");
    return {
      orderId: id(row.orderId, "Order label Order id", 191),
      claimId: string(row.claimId, "Order label claim id", 255),
      claimGeneration: positiveGeneration(row.claimGeneration, "Order label claim generation"),
      clawbackGeneration: positiveGeneration(row.clawbackGeneration, "Order label clawback generation"),
      stripeTransferId: id(row.stripeTransferId, "Order Stripe transfer"),
      transactionId: id(row.transactionId, "Order Shippo transaction"),
      rateObjectId: id(row.rateObjectId, "Order label rate"),
      amountCents: money(row.amountCents, "Order label amount"),
      currency: currency(row.currency, "Order label currency"),
      attemptCount: integer(row.attemptCount, "Order label attempt count", 1, 1000),
    };
  });
}

export async function sellerLabelDownload(
  input: { actorUserId: string; orderId: string },
  client: LabelAuthorityClient = prisma,
): Promise<SellerLabelDownloadResult> {
  const actor = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = id(input.orderId, "Order label Order id", 191);
  const value = await oneResult(client, Prisma.sql`
    SELECT public.grainline_order_seller_label_download(${actor}::text, ${orderId}::text) AS result
  `, "Order label download");
  const unauthorized = nullableAuthority(value);
  if (unauthorized) return unauthorized;
  const row = record(value, "Order label download");
  if (row.outcome === "conflict") {
    const result = conflict(row, "Order label download");
    if (result.reason !== "label_unavailable") throw new TypeError("Order label download reason is invalid");
    return { outcome: "conflict", reason: "label_unavailable" };
  }
  if (row.outcome !== "ready" || row.orderId !== orderId) {
    throw new TypeError("Order label download result is invalid");
  }
  return {
    outcome: "ready", orderId,
    transactionId: id(row.transactionId, "Order Shippo transaction"),
    rateObjectId: id(row.rateObjectId, "Order label rate"),
    amountCents: money(row.amountCents, "Order label amount"),
    currency: currency(row.currency, "Order label currency"),
  };
}

export function isValidProviderLabelUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048 && HTTPS_URL.test(value);
}
