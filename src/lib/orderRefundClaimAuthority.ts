import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type RefundClaimClient = Pick<typeof prisma, "$queryRaw">;

export type OrderRefundClaim = {
  claimId: string;
  claimGeneration: bigint;
  source: "SELLER" | "BLOCKED_CHECKOUT";
  sourceId: string;
  sourceGeneration: bigint | null;
  idempotencyScope: string;
  refundAmountCents: number;
  currency: string;
  paymentIntentId: string;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  giftWrappingPriceCents: number | null;
  taxAmountCents: number;
  canReverseTransfer: boolean;
  action: "claimed" | "replay";
};

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > max) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function requireInteger(value: unknown, label: string, min: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function requireNullableInteger(value: unknown, label: string, min: number) {
  return value === null ? null : requireInteger(value, label, min);
}

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function validateClaim(
  value: unknown,
  source: OrderRefundClaim["source"],
  sourceId: string,
  sourceGeneration: bigint | null,
) {
  if (value === null) return null;
  const row = requireRecord(value, "Order refund claim");
  const claimId = requireString(row.claimId, "Order refund claim id", 255);
  const claimGeneration = BigInt(
    requireInteger(row.claimGeneration, "Order refund claim generation", 1),
  );
  const refundAmountCents = requireInteger(
    row.refundAmountCents,
    "Order refund claim amount",
    1,
  );
  const idempotencyScope = requireString(
    row.idempotencyScope,
    "Order refund idempotency scope",
    191,
  );
  const expectedPrefix =
    source === "SELLER" ? "seller-refund" : "blocked-checkout-refund";
  if (
    idempotencyScope
      !== `${expectedPrefix}:${claimId}:FULL:${refundAmountCents}`
  ) {
    throw new TypeError("Order refund idempotency scope drifted");
  }

  const action = row.action;
  if (action !== "claimed" && action !== "replay") {
    throw new TypeError("Order refund claim action is invalid");
  }
  const currency = requireString(row.currency, "Order refund currency", 3);
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new TypeError("Order refund currency is invalid");
  }

  return {
    claimId,
    claimGeneration,
    source,
    sourceId,
    sourceGeneration,
    idempotencyScope,
    refundAmountCents,
    currency,
    paymentIntentId: requireString(
      row.paymentIntentId,
      "Order refund payment intent",
      255,
    ),
    itemsSubtotalCents: requireInteger(
      row.itemsSubtotalCents,
      "Order refund item subtotal",
      0,
    ),
    shippingAmountCents: requireInteger(
      row.shippingAmountCents,
      "Order refund shipping amount",
      0,
    ),
    giftWrappingPriceCents: requireNullableInteger(
      row.giftWrappingPriceCents,
      "Order refund gift-wrap amount",
      0,
    ),
    taxAmountCents: requireInteger(
      row.taxAmountCents,
      "Order refund tax amount",
      0,
    ),
    canReverseTransfer: requireBoolean(
      row.canReverseTransfer,
      "Order refund transfer posture",
    ),
    action,
  } satisfies OrderRefundClaim;
}

export async function claimSellerOrderRefund(
  input: { actorUserId: string; orderId: string },
  client: RefundClaimClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ claim: unknown }>>`
    SELECT public.grainline_seller_refund_claim(
      ${input.actorUserId}::text,
      ${input.orderId}::text
    ) AS claim
  `;
  if (rows.length !== 1) {
    throw new TypeError("Seller refund claim returned an invalid row count");
  }
  return validateClaim(rows[0]?.claim, "SELLER", input.actorUserId, null);
}

export async function claimBlockedCheckoutOrderRefund(
  input: {
    eventId: string;
    eventClaimGeneration: bigint;
    sessionId: string;
    orderId: string;
    expectedAmountCents: number;
  },
  client: RefundClaimClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ claim: unknown }>>`
    SELECT public.grainline_blocked_checkout_refund_claim_resume(
      ${input.eventId}::text,
      ${input.eventClaimGeneration}::bigint,
      ${input.sessionId}::text,
      ${input.orderId}::text,
      ${input.expectedAmountCents}::integer
    ) AS claim
  `;
  if (rows.length !== 1) {
    throw new TypeError(
      "Blocked-checkout refund claim returned an invalid row count",
    );
  }
  return validateClaim(
    rows[0]?.claim,
    "BLOCKED_CHECKOUT",
    input.eventId,
    input.eventClaimGeneration,
  );
}

export function activeOrderRefundClaimWhere(claim: OrderRefundClaim) {
  return {
    sellerRefundId: "pending",
    refundClaimId: claim.claimId,
    refundClaimGeneration: claim.claimGeneration,
    refundClaimSource: claim.source,
    refundClaimSourceId: claim.sourceId,
    refundClaimSourceGeneration: claim.sourceGeneration,
    refundClaimIdempotencyScope: claim.idempotencyScope,
    refundClaimProviderAuthorizedAt: { not: null },
  } satisfies Prisma.OrderWhereInput;
}

export function clearedOrderRefundClaimData() {
  return {
    refundClaimId: null,
    refundClaimSource: null,
    refundClaimSourceId: null,
    refundClaimSourceGeneration: null,
    refundClaimIdempotencyScope: null,
    refundClaimProviderAuthorizedAt: null,
  } satisfies Prisma.OrderUpdateManyMutationInput;
}

export function orderRefundClaimEvidence(claim: OrderRefundClaim) {
  return {
    refundClaimId: claim.claimId,
    refundClaimGeneration: claim.claimGeneration.toString(),
    refundClaimSource: claim.source,
    refundClaimSourceId: claim.sourceId,
    refundClaimSourceGeneration: claim.sourceGeneration?.toString() ?? null,
  } satisfies Prisma.InputJsonObject;
}
