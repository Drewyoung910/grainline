import type Stripe from "stripe";

type RefundResolution = "FULL" | "PARTIAL" | "REFUND_FULL" | "REFUND_PARTIAL";
type CreatedRefund = Pick<Stripe.Refund, "id" | "status">;
type RefundCreator = (
  params: Stripe.RefundCreateParams,
  requestOptions: { idempotencyKey: string },
) => Promise<CreatedRefund>;

type MarketplaceRefundOptions = {
  paymentIntentId: string;
  resolution: RefundResolution;
  amountCents: number;
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  giftWrappingPriceCents: number | null;
  taxAmountCents: number;
  canReverseTransfer: boolean;
  idempotencyKeyBase: string;
  reason?: Stripe.RefundCreateParams.Reason;
};

type RefundIdempotencyScope =
  | "seller-refund"
  | "case-resolve"
  | "blocked-checkout-refund";

const REFUND_IDEMPOTENCY_BASE_PATTERN =
  /^(?:seller-refund|case-resolve|blocked-checkout-refund):[A-Za-z0-9_-]+:(?:FULL|PARTIAL|REFUND_FULL|REFUND_PARTIAL):[1-9]\d*$/;

export function refundIdempotencyKeyBase({
  scope,
  id,
  resolution,
  amountCents,
}: {
  scope: RefundIdempotencyScope;
  id: string;
  resolution: RefundResolution;
  amountCents: number;
}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error("Refund idempotency amount must be a positive integer.");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new Error("Refund idempotency id contains unsupported characters.");
  }
  return `${scope}:${id}:${resolution}:${amountCents}`;
}

function assertRefundIdempotencyKeyBase(
  value: string,
  opts: Pick<MarketplaceRefundOptions, "resolution" | "amountCents">,
) {
  if (!REFUND_IDEMPOTENCY_BASE_PATTERN.test(value)) {
    throw new Error(
      "Refund idempotency key base must include scope, id, resolution, and positive amount.",
    );
  }
  if (!value.endsWith(`:${opts.resolution}:${opts.amountCents}`)) {
    throw new Error(
      "Refund idempotency key base must match the refund resolution and amount.",
    );
  }
}

function assertCreatedRefundUsable(refund: CreatedRefund) {
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new Error(
      `Stripe refund ${refund.id} returned ${refund.status} status.`,
    );
  }
}

function refundNeedsManualFollowUp(refund: CreatedRefund) {
  return refund.status === "pending" || refund.status === "requires_action";
}

export async function createMarketplaceRefundWithCreator(
  opts: MarketplaceRefundOptions,
  createStripeRefund: RefundCreator,
) {
  if (opts.amountCents <= 0) {
    throw new Error("Refund amount must be positive.");
  }

  const sellerPortionCents = Math.max(
    0,
    opts.itemsSubtotalCents +
      opts.shippingAmountCents +
      (opts.giftWrappingPriceCents ?? 0),
  );
  const taxAmountCents = Math.max(0, opts.taxAmountCents);
  const maxRefundCents = sellerPortionCents + taxAmountCents;
  const isFullRefund =
    opts.resolution === "FULL" || opts.resolution === "REFUND_FULL";
  if (opts.amountCents > maxRefundCents) {
    throw new Error("Refund amount exceeds order total.");
  }
  assertRefundIdempotencyKeyBase(opts.idempotencyKeyBase, opts);

  const createRefund = async (
    params: Stripe.RefundCreateParams,
    suffix: string,
  ) => {
    const refund = await createStripeRefund(params, {
      idempotencyKey: `${opts.idempotencyKeyBase}:${suffix}`,
    });
    assertCreatedRefundUsable(refund);
    return refund;
  };

  if (!opts.canReverseTransfer) {
    const refund = await createRefund(
      {
        payment_intent: opts.paymentIntentId,
        amount: opts.amountCents,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      "platform",
    );
    return {
      primaryRefundId: refund.id,
      refundIds: [refund.id],
      refundStatuses: [refund.status ?? null],
      requiresManualFollowUp: refundNeedsManualFollowUp(refund),
      sellerPortionCents: 0,
      taxAmountCents,
      requiresManualTransferReconciliation: true,
      usedPlatformOnly: true,
    };
  }

  if (isFullRefund && sellerPortionCents === 0) {
    const refund = await createRefund(
      {
        payment_intent: opts.paymentIntentId,
        amount: opts.amountCents,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      "tax-only",
    );

    return {
      primaryRefundId: refund.id,
      refundIds: [refund.id],
      refundStatuses: [refund.status ?? null],
      requiresManualFollowUp: refundNeedsManualFollowUp(refund),
      sellerPortionCents: 0,
      taxAmountCents,
      requiresManualTransferReconciliation: false,
      usedPlatformOnly: true,
    };
  }

  if (isFullRefund) {
    const refund = await createRefund(
      {
        payment_intent: opts.paymentIntentId,
        amount: opts.amountCents,
        reverse_transfer: true,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      "full",
    );

    return {
      primaryRefundId: refund.id,
      refundIds: [refund.id],
      refundStatuses: [refund.status ?? null],
      requiresManualFollowUp: refundNeedsManualFollowUp(refund),
      sellerPortionCents,
      taxAmountCents,
      requiresManualTransferReconciliation: false,
      usedPlatformOnly: false,
    };
  }

  const refund = await createRefund(
    {
      payment_intent: opts.paymentIntentId,
      amount: opts.amountCents,
      reverse_transfer: true,
      ...(opts.reason ? { reason: opts.reason } : {}),
    },
    "seller",
  );

  return {
    primaryRefundId: refund.id,
    refundIds: [refund.id],
    refundStatuses: [refund.status ?? null],
    requiresManualFollowUp: refundNeedsManualFollowUp(refund),
    sellerPortionCents: opts.amountCents,
    taxAmountCents: 0,
    requiresManualTransferReconciliation: false,
    usedPlatformOnly: false,
  };
}

export async function createMarketplaceRefund(opts: MarketplaceRefundOptions) {
  const { stripe } = await import("@/lib/stripe");
  return createMarketplaceRefundWithCreator(opts, (params, requestOptions) =>
    stripe.refunds.create(params, requestOptions),
  );
}
