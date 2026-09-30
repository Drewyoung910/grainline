import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type RecoveryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type OrderDisputeRecoveryClaim = Readonly<{
  recoveryId: string;
  orderId: string;
  disputeId: string;
  action: "REVERSE" | "RESTORE";
  claimGeneration: number;
  attemptCount: number;
  stripeTransferId: string;
  amountCents: number;
  currency: string;
  reversalId: string | null;
  reversedAmountCents: number | null;
  sellerStripeAccountId: string | null;
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, pattern: RegExp, max = 255) {
  if (typeof value !== "string" || value.length < 1 || value.length > max || !pattern.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function nullableText(value: unknown, label: string, pattern: RegExp, max = 255) {
  if (value === null) return null;
  return text(value, label, pattern, max);
}

function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER) {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed;
}

function nullableInteger(value: unknown, label: string, min: number) {
  if (value === null) return null;
  return integer(value, label, min);
}

function parseClaim(value: unknown): OrderDisputeRecoveryClaim {
  const row = record(value, "Order dispute recovery claim");
  const action = row.action;
  if (action !== "REVERSE" && action !== "RESTORE") {
    throw new TypeError("Order dispute recovery action is invalid");
  }
  const claim = {
    recoveryId: text(
      row.recoveryId,
      "Order dispute recovery id",
      /^order-dispute-recovery:[0-9a-f-]{36}$/,
    ),
    orderId: text(row.orderId, "Order dispute recovery Order id", /^[A-Za-z0-9._:-]+$/, 191),
    disputeId: text(row.disputeId, "Order dispute id", /^du_[A-Za-z0-9]+$/),
    action,
    claimGeneration: integer(row.claimGeneration, "Order dispute recovery claim generation", 1),
    attemptCount: integer(row.attemptCount, "Order dispute recovery attempt count", 1, 1000),
    stripeTransferId: text(row.stripeTransferId, "Order dispute recovery transfer", /^tr_[A-Za-z0-9]+$/),
    amountCents: integer(row.amountCents, "Order dispute recovery amount", 1),
    currency: text(row.currency, "Order dispute recovery currency", /^[a-z]{3}$/, 3),
    reversalId: nullableText(row.reversalId, "Order dispute recovery reversal", /^trr_[A-Za-z0-9]+$/),
    reversedAmountCents: nullableInteger(
      row.reversedAmountCents,
      "Order dispute recovery reversed amount",
      1,
    ),
    sellerStripeAccountId: nullableText(
      row.sellerStripeAccountId,
      "Order dispute recovery seller account",
      /^acct_[A-Za-z0-9]+$/,
    ),
  } satisfies OrderDisputeRecoveryClaim;
  if (
    claim.action === "RESTORE"
    && (claim.reversalId === null
      || claim.reversedAmountCents === null
      || claim.sellerStripeAccountId === null)
  ) {
    throw new TypeError("Order dispute restoration claim is incomplete");
  }
  return Object.freeze(claim);
}

export async function claimOrderDisputeRecoveryForEvent(
  paymentEventId: string,
  client: RecoveryClient,
): Promise<OrderDisputeRecoveryClaim | null> {
  const eventId = text(
    paymentEventId,
    "Order dispute payment event id",
    /^[A-Za-z0-9._:-]+$/,
    191,
  );
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_dispute_recovery_event_claim(${eventId}::text) AS result
  `);
  if (rows.length !== 1) throw new TypeError("Order dispute recovery event claim returned invalid cardinality");
  return rows[0]?.result == null ? null : parseClaim(rows[0].result);
}

export async function claimOrderDisputeRecoveryBatch(
  limit: number,
  client: RecoveryClient = prisma,
): Promise<OrderDisputeRecoveryClaim[]> {
  const bounded = integer(limit, "Order dispute recovery batch limit", 1, 50);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_dispute_recovery_claim_batch(${bounded}::integer) AS result
  `);
  if (rows.length !== 1 || !Array.isArray(rows[0]?.result)) {
    throw new TypeError("Order dispute recovery batch returned invalid result");
  }
  return rows[0].result.map(parseClaim);
}

export async function finalizeOrderDisputeRecovery(
  input: {
    recoveryId: string;
    claimGeneration: number;
    outcome: "SUCCESS" | "NOOP" | "FAILED";
    providerObjectId?: string | null;
    amountCents?: number | null;
    sellerStripeAccountId?: string | null;
    errorSummary?: string | null;
  },
  client: RecoveryClient = prisma,
) {
  const recoveryId = text(
    input.recoveryId,
    "Order dispute recovery id",
    /^order-dispute-recovery:[0-9a-f-]{36}$/,
  );
  const generation = integer(
    input.claimGeneration,
    "Order dispute recovery claim generation",
    1,
  );
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_order_dispute_recovery_finalize(
      ${recoveryId}::text,
      ${BigInt(generation)}::bigint,
      ${input.outcome}::text,
      ${input.providerObjectId ?? null}::text,
      ${input.amountCents ?? null}::integer,
      ${input.sellerStripeAccountId ?? null}::text,
      ${input.errorSummary ?? null}::text
    ) AS result
  `);
  if (rows.length !== 1) throw new TypeError("Order dispute recovery finalizer returned invalid cardinality");
  return record(rows[0]?.result, "Order dispute recovery finalizer result");
}

export async function orderDisputeRecoveryHealthSummary(
  client: RecoveryClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{
    manual_review_count: unknown;
    overdue_retry_count: unknown;
  }>>(Prisma.sql`
    SELECT manual_review_count, overdue_retry_count
      FROM public.grainline_order_dispute_recovery_health_summary()
  `);
  if (rows.length !== 1) throw new TypeError("Order dispute recovery health returned invalid cardinality");
  return Object.freeze({
    manualReviewCount: integer(
      rows[0]?.manual_review_count,
      "Order dispute recovery manual-review count",
      0,
    ),
    overdueRetryCount: integer(
      rows[0]?.overdue_retry_count,
      "Order dispute recovery overdue-retry count",
      0,
    ),
  });
}
