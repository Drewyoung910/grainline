import { prisma } from "@/lib/db";
import type { OrderRefundClaim } from "@/lib/orderRefundClaimAuthority";
import type {
  OrderRefundProviderInspection,
} from "@/lib/orderRefundProviderReconciliation";
import {
  chooseOrderRefundReconciliationAction,
  type OrderRefundReconciliationAction,
} from "@/lib/orderRefundReconciliationState";

export {
  chooseOrderRefundReconciliationAction,
  ORDER_REFUND_RECONCILIATION_WINDOWS,
} from "@/lib/orderRefundReconciliationState";
export type {
  OrderRefundReconciliationAction,
} from "@/lib/orderRefundReconciliationState";

type ReconciliationClient = Pick<typeof prisma, "$queryRaw">;

export type OrderRefundReconciliationClaim = OrderRefundClaim & {
  providerAuthorizedAtSeconds: number;
  state: "RETRY_PENDING" | "RECONCILIATION_REQUIRED";
};

export type OrderRefundAmbiguousReason =
  | "SELLER_CLAIM_DRIFT"
  | "SELLER_PROVIDER_AMBIGUOUS"
  | "BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS"
  | "ADMIN_RECONCILIATION_INTERRUPTED";

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} returned a non-object result`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string, maxLength: number) {
  if (
    typeof value !== "string"
    || value.length < 1
    || value.length > maxLength
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function integer(value: unknown, label: string, min: number) {
  const number = typeof value === "bigint" ? Number(value) : value;
  if (!Number.isSafeInteger(number) || Number(number) < min) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(number);
}

function nullableInteger(value: unknown, label: string, min: number) {
  return value === null ? null : integer(value, label, min);
}

function boolean(value: unknown, label: string) {
  if (typeof value !== "boolean") throw new TypeError(`${label} is invalid`);
  return value;
}

function validatePreparedClaim(
  value: unknown,
  expectedOrderId: string,
): OrderRefundReconciliationClaim | null {
  if (value === null) return null;
  const row = record(value, "Order refund reconciliation preparation");
  const orderId = string(row.orderId, "Order refund reconciliation Order", 191);
  if (orderId !== expectedOrderId) {
    throw new TypeError("Order refund reconciliation changed Order identity");
  }
  const claimId = string(row.claimId, "Order refund reconciliation claim", 255);
  if (!/^order_refund_claim_[0-9a-f-]{36}$/.test(claimId)) {
    throw new TypeError("Order refund reconciliation claim identity is invalid");
  }
  const claimGeneration = BigInt(integer(
    row.claimGeneration,
    "Order refund reconciliation claim generation",
    1,
  ));
  const source = row.claimSource;
  if (source !== "SELLER" && source !== "BLOCKED_CHECKOUT") {
    throw new TypeError("Order refund reconciliation source is invalid");
  }
  const sourceId = string(
    row.claimSourceId,
    "Order refund reconciliation source identity",
    255,
  );
  const sourceGeneration = nullableInteger(
    row.claimSourceGeneration,
    "Order refund reconciliation source generation",
    1,
  );
  if (
    (source === "SELLER" && sourceGeneration !== null)
    || (source === "BLOCKED_CHECKOUT" && sourceGeneration === null)
  ) {
    throw new TypeError("Order refund reconciliation source shape drifted");
  }
  const refundAmountCents = integer(
    row.refundAmountCents,
    "Order refund reconciliation amount",
    1,
  );
  const idempotencyScope = string(
    row.idempotencyScope,
    "Order refund reconciliation idempotency scope",
    191,
  );
  const expectedPrefix = source === "SELLER"
    ? "seller-refund"
    : "blocked-checkout-refund";
  if (
    idempotencyScope
      !== `${expectedPrefix}:${claimId}:FULL:${refundAmountCents}`
  ) {
    throw new TypeError("Order refund reconciliation idempotency scope drifted");
  }
  const currency = string(row.currency, "Order refund reconciliation currency", 3);
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new TypeError("Order refund reconciliation currency is invalid");
  }
  const itemsSubtotalCents = integer(
    row.itemsSubtotalCents,
    "Order refund reconciliation item subtotal",
    0,
  );
  const shippingAmountCents = integer(
    row.shippingAmountCents,
    "Order refund reconciliation shipping amount",
    0,
  );
  const giftWrappingPriceCents = nullableInteger(
    row.giftWrappingPriceCents,
    "Order refund reconciliation gift-wrap amount",
    0,
  );
  const taxAmountCents = integer(
    row.taxAmountCents,
    "Order refund reconciliation tax amount",
    0,
  );
  if (
    itemsSubtotalCents
      + shippingAmountCents
      + (giftWrappingPriceCents ?? 0)
      + taxAmountCents
      !== refundAmountCents
  ) {
    throw new TypeError("Order refund reconciliation component amount drifted");
  }
  const state = row.state;
  if (state !== "RETRY_PENDING" && state !== "RECONCILIATION_REQUIRED") {
    throw new TypeError("Order refund reconciliation state is invalid");
  }

  return {
    claimId,
    claimGeneration,
    source,
    sourceId,
    sourceGeneration:
      sourceGeneration === null ? null : BigInt(sourceGeneration),
    idempotencyScope,
    refundAmountCents,
    currency,
    paymentIntentId: string(
      row.paymentIntentId,
      "Order refund reconciliation payment intent",
      255,
    ),
    itemsSubtotalCents,
    shippingAmountCents,
    giftWrappingPriceCents,
    taxAmountCents,
    canReverseTransfer: boolean(
      row.canReverseTransfer,
      "Order refund reconciliation transfer posture",
    ),
    action: "replay",
    providerAuthorizedAtSeconds: integer(
      row.providerAuthorizedAtSeconds,
      "Order refund reconciliation provider clock",
      1,
    ),
    state,
  };
}

export async function prepareOrderRefundReconciliation(
  input: { actorUserId: string; orderId: string },
  client: ReconciliationClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ claim: unknown }>>`
    SELECT public.grainline_order_refund_reconciliation_prepare(
      ${input.actorUserId}::text,
      ${input.orderId}::text
    ) AS claim
  `;
  if (rows.length !== 1) {
    throw new TypeError("Order refund reconciliation preparation returned an invalid row count");
  }
  return validatePreparedClaim(rows[0]?.claim, input.orderId);
}

function validateTransitionResult(
  value: unknown,
  claim: OrderRefundReconciliationClaim,
  action: OrderRefundReconciliationAction,
) {
  const row = record(value, "Order refund reconciliation transition");
  const resultAction = row.action;
  const expectedActions = action === "RETRY_EXISTING_SCOPE"
    ? ["retry_authorized", "replay"]
    : action === "CONFIRMED_PROVIDER_EFFECT"
      ? ["provider_effect_authorized", "replay"]
      : ["released_no_provider_effect", "replay"];
  if (!expectedActions.includes(String(resultAction))) {
    throw new TypeError("Order refund reconciliation transition action drifted");
  }
  if (
    string(row.claimId, "Order refund reconciliation result claim", 255)
      !== claim.claimId
    || BigInt(integer(
      row.claimGeneration,
      "Order refund reconciliation result generation",
      1,
    )) !== claim.claimGeneration
    || row.status !== action
  ) {
    throw new TypeError("Order refund reconciliation transition identity drifted");
  }
  return {
    reconciliationId: string(
      row.reconciliationId,
      "Order refund reconciliation record",
      191,
    ),
    orderId: string(row.orderId, "Order refund reconciliation result Order", 191),
    action: resultAction as string,
  };
}

export async function reconcileOrderRefundClaim(
  input: {
    actorUserId: string;
    claim: OrderRefundReconciliationClaim;
    action: OrderRefundReconciliationAction;
    reason: string;
    inspection: OrderRefundProviderInspection;
  },
  client: ReconciliationClient = prisma,
) {
  const allowed = chooseOrderRefundReconciliationAction(
    input.claim,
    input.inspection,
  );
  if (allowed.action !== input.action) {
    throw new TypeError("Order refund reconciliation action does not match provider evidence");
  }
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_order_refund_reconcile(
      ${input.actorUserId}::text,
      ${input.claim.claimId}::text,
      ${input.claim.claimGeneration}::bigint,
      ${input.action}::text,
      ${input.reason}::text,
      ${input.inspection.inspectedAtSeconds}::bigint,
      ${input.inspection.disposition}::text,
      ${input.inspection.providerEvidenceSha256}::text
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError("Order refund reconciliation transition returned an invalid row count");
  }
  return validateTransitionResult(rows[0]?.result, input.claim, input.action);
}

export async function markOrderRefundClaimAmbiguous(
  input: {
    claim: Pick<OrderRefundClaim, "claimId" | "claimGeneration">;
    reason: OrderRefundAmbiguousReason;
  },
  client: ReconciliationClient = prisma,
) {
  const rows = await client.$queryRaw<Array<{ result: unknown }>>`
    SELECT public.grainline_order_refund_claim_mark_ambiguous(
      ${input.claim.claimId}::text,
      ${input.claim.claimGeneration}::bigint,
      ${input.reason}::text
    ) AS result
  `;
  if (rows.length !== 1) {
    throw new TypeError("Order refund ambiguous transition returned an invalid row count");
  }
  const row = record(rows[0]?.result, "Order refund ambiguous transition");
  if (
    string(row.claimId, "Order refund ambiguous claim", 255)
      !== input.claim.claimId
    || BigInt(integer(
      row.claimGeneration,
      "Order refund ambiguous generation",
      1,
    )) !== input.claim.claimGeneration
    || row.status !== "RECONCILIATION_REQUIRED"
    || (row.action !== "recorded" && row.action !== "replay")
  ) {
    throw new TypeError("Order refund ambiguous transition identity drifted");
  }
  return { action: row.action } as const;
}
