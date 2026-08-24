import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { OrderRefundClaim } from "@/lib/orderRefundClaimAuthority";

type RefundRecordClient = Pick<typeof prisma, "$queryRaw">;

export type OrderRefundProviderEvidence = {
  refundId: string;
  refundStatus: string | null;
  transferReversalId: string | null;
  transferReversalAmountCents: number | null;
};

export type OrderRefundRecordResult = {
  orderId: string;
  buyerUserId: string | null;
  paymentEventId: string;
  refundId: string;
  refundAmountCents: number;
  caseAction: "resolve" | "terminal" | "no_case" | "replay" | null;
  restoredActiveListingCount: number;
  action: "recorded" | "replay";
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireNullableString(
  value: unknown,
  label: string,
  maxLength: number,
) {
  return value === null ? null : requireString(value, label, maxLength);
}

function requireInteger(value: unknown, label: string, min: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function validateProviderEvidence(value: {
  primaryRefundId: string | null;
  refundIds: string[];
  refundStatuses: Array<string | null>;
  accountingEvidence: unknown;
}): OrderRefundProviderEvidence {
  const refundId = requireString(
    value.primaryRefundId,
    "Order refund provider id",
    220,
  );
  if (!/^re_[A-Za-z0-9]+$/.test(refundId)) {
    throw new TypeError("Order refund provider id is invalid");
  }
  if (value.refundIds.length !== 1 || value.refundIds[0] !== refundId) {
    throw new TypeError("Order refund provider identifiers drifted");
  }
  if (value.refundStatuses.length !== 1) {
    throw new TypeError("Order refund provider statuses drifted");
  }
  const refundStatus = requireNullableString(
    value.refundStatuses[0] ?? null,
    "Order refund provider status",
    100,
  );
  if (
    refundStatus !== null
    && !["pending", "requires_action", "succeeded"].includes(refundStatus)
  ) {
    throw new TypeError("Order refund provider status is invalid");
  }

  const accounting = requireRecord(
    value.accountingEvidence,
    "Order refund accounting evidence",
  );
  const transferReversalId = requireNullableString(
    accounting.transferReversalId ?? null,
    "Order refund transfer reversal id",
    220,
  );
  if (
    transferReversalId !== null
    && !/^trr_[A-Za-z0-9]+$/.test(transferReversalId)
  ) {
    throw new TypeError("Order refund transfer reversal id is invalid");
  }
  const transferReversalAmountCents =
    accounting.transferReversalAmountCents === null
      || accounting.transferReversalAmountCents === undefined
      ? null
      : requireInteger(
          accounting.transferReversalAmountCents,
          "Order refund transfer reversal amount",
          0,
        );
  if (transferReversalAmountCents !== null && transferReversalId === null) {
    throw new TypeError(
      "Order refund transfer reversal amount has no reversal identifier",
    );
  }

  return {
    refundId,
    refundStatus,
    transferReversalId,
    transferReversalAmountCents,
  };
}

function validateRecordResult(
  value: unknown,
  input: {
    claim: OrderRefundClaim;
    evidence: OrderRefundProviderEvidence;
    expectedOrderId: string;
    supportsCase: boolean;
  },
): OrderRefundRecordResult {
  const row = requireRecord(value, "Order refund record");
  const action = row.action;
  if (action !== "recorded" && action !== "replay") {
    throw new TypeError("Order refund record action is invalid");
  }
  const orderId = requireString(row.orderId, "Order refund record order", 191);
  if (orderId !== input.expectedOrderId) {
    throw new TypeError("Order refund record changed Order identity");
  }
  const refundId = requireString(row.refundId, "Order refund record refund", 220);
  if (refundId !== input.evidence.refundId) {
    throw new TypeError("Order refund record changed refund identity");
  }
  const refundAmountCents = requireInteger(
    row.refundAmountCents,
    "Order refund record amount",
    1,
  );
  if (refundAmountCents !== input.claim.refundAmountCents) {
    throw new TypeError("Order refund record changed refund amount");
  }
  const rawCaseAction = row.caseAction ?? null;
  const caseAction = rawCaseAction === null
    ? null
    : requireString(rawCaseAction, "Order refund Case action", 20);
  if (
    input.supportsCase
    && !["resolve", "terminal", "no_case", "replay"].includes(caseAction ?? "")
  ) {
    throw new TypeError("Order refund Case action is invalid");
  }
  if (!input.supportsCase && caseAction !== null) {
    throw new TypeError("Blocked-checkout refund unexpectedly returned a Case action");
  }

  return {
    orderId,
    buyerUserId: requireNullableString(
      row.buyerUserId ?? null,
      "Order refund record buyer",
      191,
    ),
    paymentEventId: requireString(
      row.paymentEventId,
      "Order refund payment event",
      191,
    ),
    refundId,
    refundAmountCents,
    caseAction: caseAction as OrderRefundRecordResult["caseAction"],
    restoredActiveListingCount: requireInteger(
      row.restoredActiveListingCount,
      "Order refund restored listing count",
      0,
    ),
    action,
  };
}

function validateEvidenceForClaim(
  claim: OrderRefundClaim,
  evidence: OrderRefundProviderEvidence,
) {
  const sellerPortionCents =
    claim.itemsSubtotalCents
    + claim.shippingAmountCents
    + (claim.giftWrappingPriceCents ?? 0);
  const expectsTransferReversal =
    claim.canReverseTransfer && sellerPortionCents > 0;
  const expectedTransferReversalAmountCents =
    sellerPortionCents - Math.round(claim.itemsSubtotalCents * 0.05);
  if (
    expectsTransferReversal
    && (
      evidence.transferReversalId === null
      || evidence.transferReversalAmountCents === null
      || evidence.transferReversalAmountCents
        !== expectedTransferReversalAmountCents
    )
  ) {
    throw new TypeError(
      "Order refund is missing or mismatches required transfer-reversal evidence",
    );
  }
  if (
    !expectsTransferReversal
    && (
      evidence.transferReversalId !== null
      || evidence.transferReversalAmountCents !== null
    )
  ) {
    throw new TypeError("Order refund has unexpected transfer-reversal evidence");
  }
}

export function orderRefundProviderEvidence(
  value: Parameters<typeof validateProviderEvidence>[0],
) {
  return validateProviderEvidence(value);
}

export async function recordSellerOrderRefund(
  input: {
    actorUserId: string;
    orderId: string;
    claim: OrderRefundClaim;
    evidence: OrderRefundProviderEvidence;
  },
  client: RefundRecordClient = prisma,
) {
  if (input.claim.source !== "SELLER" || input.claim.sourceGeneration !== null) {
    throw new TypeError("Seller refund record received the wrong claim family");
  }
  validateEvidenceForClaim(input.claim, input.evidence);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_seller_refund_record(
      ${input.actorUserId}::text,
      ${input.claim.claimId}::text,
      ${input.claim.claimGeneration}::bigint,
      ${input.evidence.refundId}::text,
      ${input.evidence.refundStatus}::text,
      ${input.evidence.transferReversalId}::text,
      ${input.evidence.transferReversalAmountCents}::integer
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError("Seller refund record returned an invalid row count");
  }
  return validateRecordResult(rows[0]?.result, {
    claim: input.claim,
    evidence: input.evidence,
    expectedOrderId: input.orderId,
    supportsCase: true,
  });
}

export async function recordBlockedCheckoutOrderRefund(
  input: {
    orderId: string;
    claim: OrderRefundClaim;
    evidence: OrderRefundProviderEvidence;
  },
  client: RefundRecordClient = prisma,
) {
  if (
    input.claim.source !== "BLOCKED_CHECKOUT"
    || input.claim.sourceGeneration === null
  ) {
    throw new TypeError(
      "Blocked-checkout refund record received the wrong claim family",
    );
  }
  validateEvidenceForClaim(input.claim, input.evidence);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_blocked_checkout_refund_record(
      ${input.claim.sourceId}::text,
      ${input.claim.sourceGeneration}::bigint,
      ${input.claim.claimId}::text,
      ${input.claim.claimGeneration}::bigint,
      ${input.evidence.refundId}::text,
      ${input.evidence.refundStatus}::text,
      ${input.evidence.transferReversalId}::text,
      ${input.evidence.transferReversalAmountCents}::integer
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError(
      "Blocked-checkout refund record returned an invalid row count",
    );
  }
  return validateRecordResult(rows[0]?.result, {
    claim: input.claim,
    evidence: input.evidence,
    expectedOrderId: input.orderId,
    supportsCase: false,
  });
}

export async function recordReconciledBlockedCheckoutOrderRefund(
  input: {
    reconciliationId: string;
    orderId: string;
    claim: OrderRefundClaim;
    evidence: OrderRefundProviderEvidence;
  },
  client: RefundRecordClient = prisma,
) {
  if (
    input.claim.source !== "BLOCKED_CHECKOUT"
    || input.claim.sourceGeneration === null
  ) {
    throw new TypeError(
      "Blocked-checkout reconciliation received the wrong claim family",
    );
  }
  if (!/^order-refund-reconcile:[0-9a-f-]{36}$/.test(input.reconciliationId)) {
    throw new TypeError("Blocked-checkout reconciliation identity is invalid");
  }
  validateEvidenceForClaim(input.claim, input.evidence);
  const rows = await client.$queryRaw<Array<{ result: unknown }>>(Prisma.sql`
    SELECT public.grainline_blocked_checkout_refund_reconciliation_record(
      ${input.reconciliationId}::text,
      ${input.claim.claimId}::text,
      ${input.claim.claimGeneration}::bigint,
      ${input.evidence.refundId}::text,
      ${input.evidence.refundStatus}::text,
      ${input.evidence.transferReversalId}::text,
      ${input.evidence.transferReversalAmountCents}::integer
    ) AS result
  `);
  if (rows.length !== 1) {
    throw new TypeError(
      "Blocked-checkout reconciliation record returned an invalid row count",
    );
  }
  return validateRecordResult(rows[0]?.result, {
    claim: input.claim,
    evidence: input.evidence,
    expectedOrderId: input.orderId,
    supportsCase: false,
  });
}
