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

function assertCreatedRefundUsable(refund: CreatedRefund) {
  if (refund.status === "failed" || refund.status === "canceled") {
    throw new Error(`Stripe refund ${refund.id} returned ${refund.status} status.`);
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
    opts.itemsSubtotalCents + opts.shippingAmountCents + (opts.giftWrappingPriceCents ?? 0),
  );
  const taxAmountCents = Math.max(0, opts.taxAmountCents);
  const maxRefundCents = sellerPortionCents + taxAmountCents;
  const isFullRefund = opts.resolution === "FULL" || opts.resolution === "REFUND_FULL";
  if (opts.amountCents > maxRefundCents) {
    throw new Error("Refund amount exceeds order total.");
  }

  const createRefund = async (params: Stripe.RefundCreateParams, suffix: string) => {
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
      usedPlatformOnly: false,
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
    usedPlatformOnly: false,
  };
}

export async function createMarketplaceRefund(opts: MarketplaceRefundOptions) {
  const { stripe } = await import("@/lib/stripe");
  return createMarketplaceRefundWithCreator(opts, (params, requestOptions) =>
    stripe.refunds.create(params, requestOptions),
  );
}
