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

export type StripeDisputeLike = {
  id?: string;
  amount?: number | null;
  currency?: string | null;
  reason?: string | null;
  status?: string | null;
};

export type ChargeDisputeLedgerState = {
  ledger: {
    stripeObjectId: string | null;
    amountCents: number | null;
    currency: string;
    status: string;
    reason: string | null;
    description: string;
    metadata: {
      chargeId: string;
      disputeId: string | null;
      stripeEventType: string;
    };
  };
  orderUpdate: {
    reviewNeeded: true;
    reviewNote: string;
  };
};

export type DisputeCaseAction =
  | { action: "none" }
  | { action: "update"; caseId: string; status: "UNDER_REVIEW" }
  | { action: "create"; status: "UNDER_REVIEW"; sellerRespondBy: Date; description: string };

export type StripePayoutFailureLike = {
  id: string;
  status?: string | null;
  amount?: number | null;
  currency?: string | null;
  failure_code?: string | null;
  failure_message?: string | null;
};

export type PayoutFailureState = {
  event: {
    stripePayoutId: string;
    status: string;
    amountCents: number | null;
    currency: string;
    failureCode: string | null;
    failureMessage: string | null;
    stripeEventId: string;
  };
  notification: {
    type: "PAYOUT_FAILED";
    title: "Payout failed";
    body: string;
    link: "/dashboard/seller";
  };
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

export function chargeDisputeLedgerState({
  chargeId,
  eventType,
  dispute,
  orderCurrency,
}: {
  chargeId: string;
  eventType: string;
  dispute: StripeDisputeLike;
  orderCurrency: string;
}): ChargeDisputeLedgerState {
  const description = `Stripe dispute ${eventType}${dispute.reason ? `: ${dispute.reason}` : ""}`;
  return {
    ledger: {
      stripeObjectId: dispute.id ?? null,
      amountCents: dispute.amount ?? null,
      currency: dispute.currency ?? orderCurrency,
      status: dispute.status ?? eventType.replace("charge.dispute.", ""),
      reason: dispute.reason ?? null,
      description,
      metadata: {
        chargeId,
        disputeId: dispute.id ?? null,
        stripeEventType: eventType,
      },
    },
    orderUpdate: {
      reviewNeeded: true,
      reviewNote: description,
    },
  };
}

export function disputeCaseAction({
  eventType,
  existingCase,
  dispute,
  now = new Date(),
}: {
  eventType: string;
  existingCase?: { id: string; status: string } | null;
  dispute: StripeDisputeLike;
  now?: Date;
}): DisputeCaseAction {
  if (eventType !== "charge.dispute.created") return { action: "none" };
  if (existingCase) {
    if (existingCase.status === "RESOLVED" || existingCase.status === "CLOSED") return { action: "none" };
    return { action: "update", caseId: existingCase.id, status: "UNDER_REVIEW" };
  }
  return {
    action: "create",
    status: "UNDER_REVIEW",
    sellerRespondBy: new Date(now.getTime() + 48 * 60 * 60 * 1000),
    description: `Stripe payment dispute ${dispute.id ?? ""}${dispute.reason ? `: ${dispute.reason}` : ""}`.trim(),
  };
}

export function payoutFailureState(payout: StripePayoutFailureLike, stripeEventId: string): PayoutFailureState {
  const failureMessage = payout.failure_message ?? null;
  return {
    event: {
      stripePayoutId: payout.id,
      status: payout.status ?? "failed",
      amountCents: payout.amount ?? null,
      currency: payout.currency ?? "usd",
      failureCode: payout.failure_code ?? null,
      failureMessage,
      stripeEventId,
    },
    notification: {
      type: "PAYOUT_FAILED",
      title: "Payout failed",
      body: failureMessage
        ? `Stripe could not complete a payout: ${failureMessage}`
        : "Stripe could not complete a payout. Review your Stripe account so the payout can be retried.",
      link: "/dashboard/seller",
    },
  };
}
