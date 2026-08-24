import type { Prisma } from "@prisma/client";

type SignedPaymentClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SignedRefundApplyResult = {
  action: "inserted" | "replay";
  paymentEventId: string;
  orderId: string;
  orderUpdated: boolean;
};

export type SignedDisputeApplyResult = {
  action:
    | "applied"
    | "stale_recorded"
    | "same_second_recorded"
    | "conflict_recorded"
    | "replay";
  paymentEventId: string;
  orderId: string;
  sellerUserId: string;
  buyerUserId: string;
  caseId: string | null;
  caseAction: "create" | "reopen" | "replay" | null;
  notificationAuthorized: boolean;
};

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`signed payment authority returned invalid ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string) {
  if (value === null) return null;
  return requiredString(value, field);
}

export async function applySignedRefundWebhook(
  client: SignedPaymentClient,
  input: {
    eventId: string;
    claimGeneration: bigint;
    chargeId: string;
    eventCreatedSeconds: number;
    amountRefundedCents: number;
    currency: string;
    refundId: string | null;
    refundAmountCents: number | null;
    refundStatus: string | null;
    refundCreatedSeconds: number | null;
    refundReason: string | null;
  },
): Promise<SignedRefundApplyResult> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      result.action,
      result."paymentEventId",
      result."orderId",
      result."orderUpdated"
    FROM public.grainline_order_payment_signed_refund_apply(
      ${input.eventId}::text,
      ${input.claimGeneration}::bigint,
      ${input.chargeId}::text,
      ${input.eventCreatedSeconds}::bigint,
      ${input.amountRefundedCents}::integer,
      ${input.currency}::text,
      ${input.refundId}::text,
      ${input.refundAmountCents}::integer,
      ${input.refundStatus}::text,
      ${input.refundCreatedSeconds}::bigint,
      ${input.refundReason}::text
    ) AS result
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("signed refund authority returned invalid cardinality");
  }
  if (row.action !== "inserted" && row.action !== "replay") {
    throw new TypeError("signed refund authority returned invalid action");
  }
  if (typeof row.orderUpdated !== "boolean") {
    throw new TypeError("signed refund authority returned invalid update state");
  }
  if (row.action === "replay" && row.orderUpdated) {
    throw new TypeError("signed refund replay returned an impossible update state");
  }
  return {
    action: row.action,
    paymentEventId: requiredString(row.paymentEventId, "payment event id"),
    orderId: requiredString(row.orderId, "order id"),
    orderUpdated: row.orderUpdated,
  };
}

export async function applySignedDisputeWebhook(
  client: SignedPaymentClient,
  input: {
    eventId: string;
    claimGeneration: bigint;
    chargeId: string;
    disputeId: string;
    eventCreatedSeconds: number;
    amountCents: number;
    currency: string;
    reason: string | null;
    status: string;
  },
): Promise<SignedDisputeApplyResult> {
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      result.action,
      result."paymentEventId",
      result."orderId",
      result."sellerUserId",
      result."buyerUserId",
      result."caseId",
      result."caseAction",
      result."notificationAuthorized"
    FROM public.grainline_order_payment_signed_dispute_apply(
      ${input.eventId}::text,
      ${input.claimGeneration}::bigint,
      ${input.chargeId}::text,
      ${input.disputeId}::text,
      ${input.eventCreatedSeconds}::bigint,
      ${input.amountCents}::integer,
      ${input.currency}::text,
      ${input.reason}::text,
      ${input.status}::text
    ) AS result
  `;
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("signed dispute authority returned invalid cardinality");
  }
  const allowedActions = new Set([
    "applied",
    "stale_recorded",
    "same_second_recorded",
    "conflict_recorded",
    "replay",
  ]);
  if (typeof row.action !== "string" || !allowedActions.has(row.action)) {
    throw new TypeError("signed dispute authority returned invalid action");
  }
  const caseAction = nullableString(row.caseAction, "Case action");
  if (caseAction !== null && !["create", "reopen", "replay"].includes(caseAction)) {
    throw new TypeError("signed dispute authority returned invalid Case action");
  }
  if (typeof row.notificationAuthorized !== "boolean") {
    throw new TypeError("signed dispute authority returned invalid notification state");
  }
  const caseId = nullableString(row.caseId, "Case id");
  if (
    row.notificationAuthorized
    && (row.action !== "applied" || caseId === null || !["create", "reopen"].includes(caseAction ?? ""))
  ) {
    throw new TypeError("signed dispute authority authorized an invalid notification");
  }
  if (row.action !== "applied" && (caseId !== null || caseAction !== null || row.notificationAuthorized)) {
    throw new TypeError("signed dispute non-application returned participant side effects");
  }
  return {
    action: row.action as SignedDisputeApplyResult["action"],
    paymentEventId: requiredString(row.paymentEventId, "payment event id"),
    orderId: requiredString(row.orderId, "order id"),
    sellerUserId: requiredString(row.sellerUserId, "seller user id"),
    buyerUserId: requiredString(row.buyerUserId, "buyer user id"),
    caseId,
    caseAction: caseAction as SignedDisputeApplyResult["caseAction"],
    notificationAuthorized: row.notificationAuthorized,
  };
}
