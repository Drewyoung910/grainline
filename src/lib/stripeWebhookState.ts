import type { CaseStatus } from "@prisma/client";
import { DEFAULT_CURRENCY } from "./money.ts";
import {
  REFUND_AMBIGUOUS_SENTINEL,
  REFUND_LOCK_SENTINEL,
  isStaleRefundLock,
} from "./refundLockState.ts";
import { STRIPE_DISPUTE_CLOSED_STATUSES } from "./refundRouteState.ts";

export type StripeRefundLike = {
  id?: string;
  amount?: number;
  status?: string | null;
  created?: number | null;
  reason?: string | null;
};

// Stripe can retry live webhooks for up to 3 days and manual CLI resends for
// up to 30 days; keep the app-side age gate aligned with that recovery window.
export const STRIPE_WEBHOOK_MAX_EVENT_AGE_SECONDS = 30 * 24 * 60 * 60;
export const STRIPE_WEBHOOK_FUTURE_SKEW_SECONDS = 10 * 60;
export const SHIPPING_ESTIMATED_DAYS_MAX = 60;

export function isStaleStripeEvent(
  created: number | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
  maxAgeSeconds = STRIPE_WEBHOOK_MAX_EVENT_AGE_SECONDS,
) {
  return typeof created !== "number" ||
    !Number.isFinite(created) ||
    created > nowSeconds + STRIPE_WEBHOOK_FUTURE_SKEW_SECONDS ||
    created < nowSeconds - maxAgeSeconds;
}

export type CheckoutSellerState = {
  id: string;
  userId: string;
  chargesEnabled: boolean;
  stripeAccountId: string | null;
  vacationMode?: boolean | null;
  acceptingNewOrders?: boolean | null;
  user: { id: string; banned: boolean; deletedAt: Date | null } | null;
};

export type CheckoutBuyerState = {
  id: string;
  banned: boolean;
  deletedAt: Date | null;
} | null;

export type CheckoutListingState = {
  id: string;
  status: string;
  isPrivate: boolean;
  reservedForUserId: string | null;
} | null;

export type CheckoutInvalidReasonState = {
  reason: string;
  buyerInvalidReason: string | null;
  buyerUserId: string | null;
  sellerUserIds: string[];
};

export type ChargeRefundOrderState = {
  currency: string;
  sellerRefundId: string | null;
  sellerRefundLockedAt?: Date | null;
  sellerRefundAmountCents: number | null;
  itemsSubtotalCents?: number | null;
  shippingAmountCents?: number | null;
  giftWrappingPriceCents?: number | null;
  taxAmountCents?: number | null;
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
      pendingLocalRefundLock: boolean;
      orderTotalCents: number;
      refundExceedsOrderTotal: boolean;
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
      stripeEventCreated: number | null;
    };
  };
  orderUpdate: {
    reviewNeeded: true;
    reviewNote: string;
    sellerRefundLockedAt?: null;
  };
};

export type LatestDisputeLedgerEventState = {
  stripeEventId?: string | null;
  status?: string | null;
  stripeEventCreated?: number | bigint | null;
};

export type DisputeCaseAction =
  | { action: "none" }
  | { action: "update"; caseId: string; expectedStatus: CaseStatus; status: "UNDER_REVIEW" }
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

export type BlockedCheckoutDisputeState = {
  reviewNeeded: true;
  reviewNote: string;
  disputeId: string | null;
  disputeStatus: string | null;
};

export type StripeEventEnvelope = {
  id?: string;
  type?: string;
  created?: number;
  api_version?: string | null;
  data?: { object?: unknown };
};

const THIN_STRIPE_EVENT_OBJECT_KEYS = new Set(["id", "object", "livemode"]);

function isOpenDisputeStatus(status: string | null | undefined) {
  return !STRIPE_DISPUTE_CLOSED_STATUSES.has((status ?? "").toLowerCase());
}

function disputeEventCreatedSeconds(value: number | bigint | null | undefined) {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function shouldApplyDisputeWebhookSideEffects({
  currentEventCreated,
  currentStatus,
  latestEvent,
}: {
  currentEventCreated: number | null | undefined;
  currentStatus: string | null | undefined;
  latestEvent?: LatestDisputeLedgerEventState | null;
}) {
  if (!latestEvent) return true;
  const currentCreated = disputeEventCreatedSeconds(currentEventCreated);
  const latestCreated = disputeEventCreatedSeconds(latestEvent.stripeEventCreated);
  if (currentCreated == null || latestCreated == null) return true;
  if (currentCreated < latestCreated) return false;
  if (
    currentCreated === latestCreated &&
    isOpenDisputeStatus(currentStatus) &&
    !isOpenDisputeStatus(latestEvent.status)
  ) {
    return false;
  }
  return true;
}

export type CheckoutPriceDriftState = {
  reasons: Array<"stripe_unit_amount_mismatch" | "price_version_changed">;
  stripeUnitAmountCents: number | null;
  expectedUnitAmountCents: number | null;
  checkoutPriceVersion: number | null;
  currentPriceVersion: number | null;
};

export function latestSuccessfulRefund(refunds: StripeRefundLike[]) {
  return refunds
    .filter((refund) => (refund.status ?? "").toLowerCase() === "succeeded")
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null;
}

export const POSTGRES_INT_MAX = 2_147_483_647;

export function parsePositiveInt(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= POSTGRES_INT_MAX ? parsed : fallback;
}

export function parseBoundedPositiveInt(
  value: string | number | null | undefined,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

export function parseOptionalNonNegativeInt(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= POSTGRES_INT_MAX ? parsed : null;
}

type CheckoutSubtotalLineItem = {
  amount_subtotal?: number | null;
  quantity?: number | null;
  price?: {
    unit_amount?: number | null;
    product?: { metadata?: Record<string, string | undefined> | null } | string | null;
  } | null;
};

function checkoutListingLineItemsSubtotalCents(lineItems: CheckoutSubtotalLineItem[]): number | null {
  let subtotalCents = 0;
  let foundListingLineItem = false;

  for (const lineItem of lineItems) {
    const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
    if (!product?.metadata?.listingId) continue;
    foundListingLineItem = true;

    const amountSubtotalCents = parseOptionalNonNegativeInt(lineItem.amount_subtotal);
    if (amountSubtotalCents != null) {
      if (subtotalCents + amountSubtotalCents > POSTGRES_INT_MAX) return null;
      subtotalCents += amountSubtotalCents;
      continue;
    }

    const unitAmountCents = parseOptionalNonNegativeInt(lineItem.price?.unit_amount);
    const quantity = parseOptionalNonNegativeInt(lineItem.quantity);
    if (unitAmountCents == null || quantity == null || quantity <= 0) return null;
    const lineSubtotalCents = unitAmountCents * quantity;
    if (lineSubtotalCents > POSTGRES_INT_MAX || subtotalCents + lineSubtotalCents > POSTGRES_INT_MAX) {
      return null;
    }
    subtotalCents += lineSubtotalCents;
  }

  return foundListingLineItem ? subtotalCents : null;
}

export function checkoutItemsSubtotalCents({
  lineItems,
  metadataItemsSubtotalCents,
  checkoutAmountSubtotalCents,
  giftWrappingPriceCents,
}: {
  lineItems: CheckoutSubtotalLineItem[];
  metadataItemsSubtotalCents?: number | null;
  checkoutAmountSubtotalCents?: number | null;
  giftWrappingPriceCents?: number | null;
}): number {
  const listingLineSubtotalCents = checkoutListingLineItemsSubtotalCents(lineItems);
  if (listingLineSubtotalCents != null) return listingLineSubtotalCents;

  if (
    metadataItemsSubtotalCents != null &&
    metadataItemsSubtotalCents >= 0 &&
    metadataItemsSubtotalCents <= POSTGRES_INT_MAX
  ) {
    return metadataItemsSubtotalCents;
  }

  const checkoutSubtotalCents = parseOptionalNonNegativeInt(checkoutAmountSubtotalCents);
  if (checkoutSubtotalCents == null) return 0;

  const safeGiftWrappingPriceCents = giftWrappingPriceCents != null &&
    giftWrappingPriceCents >= 0 &&
    giftWrappingPriceCents <= POSTGRES_INT_MAX
    ? giftWrappingPriceCents
    : 0;
  return Math.max(0, checkoutSubtotalCents - safeGiftWrappingPriceCents);
}

export function normalizeShippoRateObjectId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "pickup" || normalized === "fallback" ? null : value;
}

export function checkoutPriceDriftState(input: {
  stripeUnitAmountCents?: number | null;
  expectedUnitAmountCents?: number | null;
  checkoutPriceVersion?: number | null;
  currentPriceVersion?: number | null;
}): CheckoutPriceDriftState | null {
  const stripeUnitAmountCents = Number.isInteger(input.stripeUnitAmountCents)
    ? input.stripeUnitAmountCents ?? null
    : null;
  const expectedUnitAmountCents = Number.isInteger(input.expectedUnitAmountCents)
    ? input.expectedUnitAmountCents ?? null
    : null;
  const checkoutPriceVersion = Number.isInteger(input.checkoutPriceVersion)
    ? input.checkoutPriceVersion ?? null
    : null;
  const currentPriceVersion = Number.isInteger(input.currentPriceVersion)
    ? input.currentPriceVersion ?? null
    : null;

  const reasons: CheckoutPriceDriftState["reasons"] = [];
  if (
    stripeUnitAmountCents != null &&
    expectedUnitAmountCents != null &&
    stripeUnitAmountCents !== expectedUnitAmountCents
  ) {
    reasons.push("stripe_unit_amount_mismatch");
  }
  if (
    checkoutPriceVersion != null &&
    currentPriceVersion != null &&
    checkoutPriceVersion !== currentPriceVersion
  ) {
    reasons.push("price_version_changed");
  }

  return reasons.length > 0
    ? {
        reasons,
        stripeUnitAmountCents,
        expectedUnitAmountCents,
        checkoutPriceVersion,
        currentPriceVersion,
      }
    : null;
}

export function isLikelyThinStripeEventObject(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object);
  return (
    typeof object.id === "string" &&
    typeof object.object === "string" &&
    keys.length <= THIN_STRIPE_EVENT_OBJECT_KEYS.size &&
    keys.every((key) => THIN_STRIPE_EVENT_OBJECT_KEYS.has(key))
  );
}

export function retrievedStripeEventMatchesSignedEnvelope(
  signedEvent: StripeEventEnvelope,
  retrievedEvent: StripeEventEnvelope,
): boolean {
  return (
    signedEvent.id === retrievedEvent.id &&
    signedEvent.type === retrievedEvent.type &&
    signedEvent.created === retrievedEvent.created &&
    signedEvent.api_version === retrievedEvent.api_version
  );
}

export function invalidCheckoutSellerReason(seller: CheckoutSellerState | null | undefined): string | null {
  if (!seller) return "Seller account could not be verified at payment completion.";
  if (seller.user?.banned) return "Seller account was suspended before payment completion.";
  if (seller.user?.deletedAt) return "Seller account was deleted before payment completion.";
  if (!seller.chargesEnabled) return "Seller Stripe account was disabled before payment completion.";
  if (!seller.stripeAccountId) return "Seller Stripe account was disconnected before payment completion.";
  if (seller.vacationMode) return "Seller entered vacation mode before payment completion.";
  if (seller.acceptingNewOrders === false) return "Seller stopped accepting new orders before payment completion.";
  return null;
}

export function invalidCheckoutBuyerReason(buyer: CheckoutBuyerState | undefined): string | null {
  if (!buyer) return "Buyer account could not be verified at payment completion.";
  if (buyer.banned) return "Buyer account was suspended before payment completion.";
  if (buyer.deletedAt) return "Buyer account was deleted before payment completion.";
  return null;
}

export function invalidCheckoutListingReason(
  listing: CheckoutListingState | undefined,
  buyerUserId: string | null | undefined,
): string | null {
  if (!listing) return "Listing could not be verified at payment completion.";
  if (listing.status !== "ACTIVE") return "Listing was no longer active before payment completion.";
  if (listing.isPrivate && listing.reservedForUserId !== buyerUserId) {
    return "Listing reservation changed before payment completion.";
  }
  return null;
}

export function checkoutInvalidReasonState(input: {
  buyer: CheckoutBuyerState | undefined;
  sellers: Array<CheckoutSellerState | null | undefined>;
  listings?: Array<CheckoutListingState | undefined>;
  buyerUserId?: string | null;
}): CheckoutInvalidReasonState {
  const buyerReason = invalidCheckoutBuyerReason(input.buyer);
  const invalidSellers = new Map<string, { reason: string; sellerUserId: string }>();
  for (let index = 0; index < input.sellers.length; index += 1) {
    const seller = input.sellers[index];
    const reason = invalidCheckoutSellerReason(seller);
    if (!reason) continue;
    invalidSellers.set(seller?.id ?? `missing:${index}`, {
      reason,
      sellerUserId: seller?.userId ?? "",
    });
  }
  const invalidListings = new Map<string, string>();
  const effectiveBuyerUserId = buyerReason ? null : input.buyer?.id ?? input.buyerUserId ?? null;
  for (let index = 0; index < (input.listings ?? []).length; index += 1) {
    const listing = input.listings?.[index];
    const reason = invalidCheckoutListingReason(listing, effectiveBuyerUserId);
    if (!reason) continue;
    invalidListings.set(listing?.id ?? `missing:${index}`, reason);
  }

  return {
    reason: [
      buyerReason,
      ...[...invalidSellers.values()].map((value) => value.reason),
      ...invalidListings.values(),
    ].filter(Boolean).join(" "),
    buyerInvalidReason: buyerReason,
    buyerUserId: effectiveBuyerUserId,
    sellerUserIds: [...invalidSellers.values()]
      .map((value) => value.sellerUserId)
      .filter(Boolean),
  };
}

export function blockedCheckoutDisputeState({
  latestDispute,
  reviewPrefix,
}: {
  latestDispute: { status: string | null; stripeObjectId: string | null } | null | undefined;
  reviewPrefix: string;
}): BlockedCheckoutDisputeState | null {
  if (!latestDispute || !isOpenDisputeStatus(latestDispute.status)) return null;
  const disputeId = latestDispute.stripeObjectId ?? null;
  const disputeLabel = disputeId ?? "unknown";
  return {
    reviewNeeded: true,
    reviewNote: `${reviewPrefix} Automatic refund was skipped because Stripe dispute ${disputeLabel} is still open; staff must reconcile this payment manually.`,
    disputeId,
    disputeStatus: latestDispute.status ?? null,
  };
}

export function chargeRefundLedgerState({
  chargeId,
  chargeCurrency,
  amountRefundedCents,
  latestRefund,
  fallbackRefundId,
  order,
}: {
  chargeId: string;
  chargeCurrency?: string | null;
  amountRefundedCents?: number | null;
  latestRefund: StripeRefundLike | null | undefined;
  fallbackRefundId?: string | null;
  order: ChargeRefundOrderState;
}): ChargeRefundLedgerState {
  const latestRefundId = latestRefund?.id ?? fallbackRefundId ?? `external:${chargeId}`;
  const totalRefundedCents = amountRefundedCents ?? latestRefund?.amount ?? 0;
  const orderTotalCents =
    (order.itemsSubtotalCents ?? 0) +
    (order.shippingAmountCents ?? 0) +
    (order.giftWrappingPriceCents ?? 0) +
    (order.taxAmountCents ?? 0);
  const refundExceedsOrderTotal = orderTotalCents > 0 && totalRefundedCents > orderTotalCents;
  const hasLocalRefundAudit =
    !!order.sellerRefundId &&
    order.sellerRefundId !== REFUND_LOCK_SENTINEL &&
    order.sellerRefundId !== REFUND_AMBIGUOUS_SENTINEL &&
    !order.sellerRefundId.startsWith("external:");
  const hasFreshLocalRefundLock =
    order.sellerRefundId === REFUND_LOCK_SENTINEL &&
    !isStaleRefundLock({
      sellerRefundId: order.sellerRefundId,
      sellerRefundLockedAt: order.sellerRefundLockedAt ?? null,
    });
  const isKnownLocalRefund = hasLocalRefundAudit && order.sellerRefundId === latestRefundId;
  const isAdditionalExternalRefund = hasLocalRefundAudit && !isKnownLocalRefund;
  const reason =
    hasFreshLocalRefundLock
      ? "local_refund_pending_confirmation"
      : latestRefund?.reason ??
        (isKnownLocalRefund
          ? "local_refund_confirmed"
          : isAdditionalExternalRefund
            ? "additional_external_refund"
            : "external_refund");
  const description = isKnownLocalRefund
    ? "Stripe confirmed a Grainline-tracked refund."
    : hasFreshLocalRefundLock
      ? "Stripe reported a refund while Grainline was recording local refund side effects."
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
      pendingLocalRefundLock: hasFreshLocalRefundLock,
      orderTotalCents,
      refundExceedsOrderTotal,
    },
  };

  if (order.sellerRefundId === latestRefundId) {
    return { latestRefundId, totalRefundedCents, ledger, orderUpdate: null };
  }

  if (hasFreshLocalRefundLock) {
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
        reviewNote: refundExceedsOrderTotal
          ? "Additional Stripe refund was detected outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment. Local refund audit ID was preserved."
          : "Additional Stripe refund was detected outside Grainline; local refund audit ID was preserved.",
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
      reviewNote: refundExceedsOrderTotal
        ? "Stripe refund was created outside Grainline; total refunded exceeds the order total and staff must reconcile before fulfillment."
        : "Stripe refund was created outside Grainline.",
    },
  };
}

export function chargeDisputeLedgerState({
  chargeId,
  eventType,
  stripeEventCreated,
  dispute,
  orderCurrency,
}: {
  chargeId: string;
  eventType: string;
  stripeEventCreated?: number | null;
  dispute: StripeDisputeLike;
  orderCurrency: string;
}): ChargeDisputeLedgerState {
  const description = `Stripe dispute ${eventType}${dispute.reason ? `: ${dispute.reason}` : ""}`;
  const status = dispute.status ?? eventType.replace("charge.dispute.", "");
  const shouldClearRefundLock =
    eventType === "charge.dispute.closed" ||
    STRIPE_DISPUTE_CLOSED_STATUSES.has((dispute.status ?? "").toLowerCase());
  return {
    ledger: {
      stripeObjectId: dispute.id ?? null,
      amountCents: dispute.amount ?? null,
      currency: dispute.currency ?? orderCurrency,
      status,
      reason: dispute.reason ?? null,
      description,
      metadata: {
        chargeId,
        disputeId: dispute.id ?? null,
        stripeEventType: eventType,
        stripeEventCreated: stripeEventCreated ?? null,
      },
    },
    orderUpdate: {
      reviewNeeded: true,
      reviewNote: description,
      ...(shouldClearRefundLock ? { sellerRefundLockedAt: null } : {}),
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
  existingCase?: { id: string; status: CaseStatus } | null;
  dispute: StripeDisputeLike;
  now?: Date;
}): DisputeCaseAction {
  if (eventType !== "charge.dispute.created") return { action: "none" };
  if (existingCase) {
    return {
      action: "update",
      caseId: existingCase.id,
      expectedStatus: existingCase.status,
      status: "UNDER_REVIEW",
    };
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
      currency: payout.currency ?? DEFAULT_CURRENCY,
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
