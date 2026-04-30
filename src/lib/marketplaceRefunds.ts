import type Stripe from "stripe";

type RefundResolution = "FULL" | "PARTIAL" | "REFUND_FULL" | "REFUND_PARTIAL";
type CreatedRefund = Pick<Stripe.Refund, "id">;
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

export class StripeRefundPartialFailure extends Error {
  refundIds: string[];
  primaryRefundId: string | null;
  cause: unknown;

  constructor(cause: unknown, refundIds: string[]) {
    super("Stripe refund partially succeeded before a later refund step failed.");
    this.name = "StripeRefundPartialFailure";
    this.cause = cause;
    this.refundIds = refundIds;
    this.primaryRefundId = refundIds[0] ?? null;
  }
}

export function isStripeRefundPartialFailure(error: unknown): error is StripeRefundPartialFailure {
  return error instanceof StripeRefundPartialFailure;
}

export async function createMarketplaceRefundWithCreator(
  opts: MarketplaceRefundOptions,
  createStripeRefund: RefundCreator,
) {
  if (opts.amountCents <= 0) {
    throw new Error("Refund amount must be positive.");
  }

  const refundIds: string[] = [];
  const sellerPortionCents = Math.max(
    0,
    opts.itemsSubtotalCents + opts.shippingAmountCents + (opts.giftWrappingPriceCents ?? 0),
  );
  const taxAmountCents = Math.max(0, opts.taxAmountCents);
  const isFullRefund = opts.resolution === "FULL" || opts.resolution === "REFUND_FULL";

  const createRefund = async (params: Stripe.RefundCreateParams, suffix: string) => {
    const refund = await createStripeRefund(params, {
      idempotencyKey: `${opts.idempotencyKeyBase}:${suffix}`,
    });
    refundIds.push(refund.id);
    return refund;
  };

  try {
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
        sellerPortionCents: 0,
        taxAmountCents,
        usedPlatformOnly: true,
        usedSplitTaxRefund: false,
      };
    }

    if (isFullRefund && taxAmountCents > 0 && sellerPortionCents > 0) {
      const sellerRefund = await createRefund(
        {
          payment_intent: opts.paymentIntentId,
          amount: sellerPortionCents,
          refund_application_fee: true,
          reverse_transfer: true,
          ...(opts.reason ? { reason: opts.reason } : {}),
        },
        "seller",
      );

      const taxRefund = await createRefund(
        {
          payment_intent: opts.paymentIntentId,
          amount: taxAmountCents,
          ...(opts.reason ? { reason: opts.reason } : {}),
        },
        "tax",
      );

      return {
        primaryRefundId: sellerRefund.id,
        refundIds: [sellerRefund.id, taxRefund.id],
        sellerPortionCents,
        taxAmountCents,
        usedPlatformOnly: false,
        usedSplitTaxRefund: true,
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
        sellerPortionCents: 0,
        taxAmountCents,
        usedPlatformOnly: false,
        usedSplitTaxRefund: false,
      };
    }

    const refund = await createRefund(
      {
        payment_intent: opts.paymentIntentId,
        amount: opts.amountCents,
        refund_application_fee: true,
        reverse_transfer: true,
        ...(opts.reason ? { reason: opts.reason } : {}),
      },
      "seller",
    );

    return {
      primaryRefundId: refund.id,
      refundIds: [refund.id],
      sellerPortionCents: opts.amountCents,
      taxAmountCents: isFullRefund ? taxAmountCents : 0,
      usedPlatformOnly: false,
      usedSplitTaxRefund: false,
    };
  } catch (error) {
    if (refundIds.length > 0) {
      throw new StripeRefundPartialFailure(error, refundIds);
    }
    throw error;
  }
}

export async function createMarketplaceRefund(opts: MarketplaceRefundOptions) {
  const { stripe } = await import("@/lib/stripe");
  return createMarketplaceRefundWithCreator(opts, (params, requestOptions) =>
    stripe.refunds.create(params, requestOptions),
  );
}
