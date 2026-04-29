export type StripeRefundLike = {
  id?: string;
  amount?: number;
  status?: string | null;
  created?: number | null;
  reason?: string | null;
};

export type CheckoutSellerState = {
  id: string;
  userId: string;
  chargesEnabled: boolean;
  stripeAccountId: string | null;
  user: { id: string; banned: boolean; deletedAt: Date | null } | null;
};

export type ChargeRefundOrderState = {
  currency: string;
  sellerRefundId: string | null;
  sellerRefundAmountCents: number | null;
};

export type ChargeRefundLedgerState = {
  latestRefundId: string;
  totalRefundedCents: number;
  ledger: {
    stripeObjectId: string;
    amountCents: number;
    currency: string;
    status: string;
    reason: string;
    description: string;
    metadata: {
      chargeId: string;
      latestRefundId: string;
      latestRefundAmountCents: number | null;
      totalRefundedCents: number;
      preservedLocalRefundId: string | null;
    };
  };
  orderUpdate:
    | {
        sellerRefundId?: string;
        sellerRefundAmountCents: number;
        sellerRefundLockedAt: null;
        reviewNeeded: true;
        reviewNote: string;
      }
    | null;
};

export function latestSuccessfulRefund(refunds: StripeRefundLike[]) {
  return refunds
    .filter((refund) => refund.status !== "failed")
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null;
}

export function parsePositiveInt(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseOptionalNonNegativeInt(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeShippoRateObjectId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "pickup" || normalized === "fallback" ? null : value;
}

export function invalidCheckoutSellerReason(seller: CheckoutSellerState | null | undefined): string | null {
  if (!seller) return "Seller account could not be verified at payment completion.";
  if (seller.user?.banned) return "Seller account was suspended before payment completion.";
  if (seller.user?.deletedAt) return "Seller account was deleted before payment completion.";
  if (!seller.chargesEnabled) return "Seller Stripe account was disabled before payment completion.";
  if (!seller.stripeAccountId) return "Seller Stripe account was disconnected before payment completion.";
  return null;
}

export function chargeRefundLedgerState({
  chargeId,
  chargeCurrency,
  amountRefundedCents,
  latestRefund,
  order,
}: {
  chargeId: string;
  chargeCurrency?: string | null;
  amountRefundedCents?: number | null;
  latestRefund: StripeRefundLike | null | undefined;
  order: ChargeRefundOrderState;
}): ChargeRefundLedgerState {
  const latestRefundId = latestRefund?.id ?? `external:${chargeId}`;
  const totalRefundedCents = amountRefundedCents ?? latestRefund?.amount ?? 0;
  const hasLocalRefundAudit =
    !!order.sellerRefundId &&
    order.sellerRefundId !== "pending" &&
    !order.sellerRefundId.startsWith("external:");
  const isKnownLocalRefund = hasLocalRefundAudit && order.sellerRefundId === latestRefundId;
  const isAdditionalExternalRefund = hasLocalRefundAudit && !isKnownLocalRefund;
  const reason =
    latestRefund?.reason ??
    (isKnownLocalRefund
      ? "local_refund_confirmed"
      : isAdditionalExternalRefund
        ? "additional_external_refund"
        : "external_refund");
  const description = isKnownLocalRefund
    ? "Stripe confirmed a Grainline-tracked refund."
    : isAdditionalExternalRefund
      ? "Stripe reported an additional refund outside the local Grainline refund record."
      : "Stripe reported a refund created outside Grainline.";
  const ledger = {
    stripeObjectId: latestRefundId,
    amountCents: latestRefund?.amount ?? totalRefundedCents,
    currency: chargeCurrency ?? order.currency,
    status: latestRefund?.status ?? "refunded",
    reason,
    description,
    metadata: {
      chargeId,
      latestRefundId,
      latestRefundAmountCents: latestRefund?.amount ?? null,
      totalRefundedCents,
      preservedLocalRefundId: isAdditionalExternalRefund ? order.sellerRefundId : null,
    },
  };

  if (order.sellerRefundId === latestRefundId) {
    return { latestRefundId, totalRefundedCents, ledger, orderUpdate: null };
  }

  if (isAdditionalExternalRefund) {
    return {
      latestRefundId,
      totalRefundedCents,
      ledger,
      orderUpdate: {
        sellerRefundAmountCents: Math.max(order.sellerRefundAmountCents ?? 0, totalRefundedCents),
        sellerRefundLockedAt: null,
        reviewNeeded: true,
        reviewNote: "Additional Stripe refund was detected outside Grainline; local refund audit ID was preserved.",
      },
    };
  }

  return {
    latestRefundId,
    totalRefundedCents,
    ledger,
    orderUpdate: {
      sellerRefundId: latestRefundId,
      sellerRefundAmountCents: totalRefundedCents,
      sellerRefundLockedAt: null,
      reviewNeeded: true,
      reviewNote: "Stripe refund was created outside Grainline.",
    },
  };
}
