// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import {
  createNotification,
  createNotificationOrThrow,
  shouldSendEmail,
} from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import {
  renderFirstSaleCongratsEmail,
  renderOrderConfirmedBuyerEmail,
  renderOrderConfirmedSellerEmail,
  sendRenderedEmail,
} from "@/lib/email";
import { enqueueEmailOutboxOnce, type QueuedEmail } from "@/lib/emailOutbox";
import { emailOutboxFailureState } from "@/lib/emailOutboxState";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { isRequestBodyTooLargeError, readBoundedText } from "@/lib/requestBody";
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/lib/stripeWebhookEvents";
import { mirrorStripeChargesEnabled } from "@/lib/stripeWebhookMirror";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import {
  restoreUnorderedCheckoutStockOnce,
  type CheckoutStockRestoreLineItem,
} from "@/lib/checkoutStockRestore";
import {
  orderHasRefundLedger,
} from "@/lib/refundRouteState";
import { isStripeSessionUniqueConstraintError } from "@/lib/stripeWebhookEventState";
import {
  REFUND_LOCK_SENTINEL,
  isStaleRefundLock,
} from "@/lib/refundLockState";
import { releaseBlockedCheckoutLegacyRefundLock } from "@/lib/orderLegacyRefundLockAuthority";
import { stripeWebhookCreatedSeconds } from "@/lib/stripeConnectV2";
import { processStripePayoutFailedEvent } from "@/lib/stripePayoutWebhook";
import { applyStripeSellerDeauthorization } from "@/lib/orderSellerDeauthorizationAuthority";
import { createOrderFromPaidCheckout } from "@/lib/orderPaidCheckoutAuthority";
import { readCheckoutPostpaymentProjection } from "@/lib/orderCheckoutPostpaymentAuthority";
import {
  revalidateFeaturedMakerCaches,
  revalidateListingSearchCaches,
  revalidatePublicSellerVisibilityCaches,
} from "@/lib/searchCache";
import {
  blockedCheckoutDisputeState,
  checkoutItemsSubtotalCents,
  isLikelyThinStripeEventObject,
  isStaleStripeEvent,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  parseBoundedPositiveInt,
  parseOptionalNonNegativeInt,
  requireCheckoutChargedTotalCents,
  retrievedStripeEventMatchesSignedEnvelope,
  SHIPPING_ESTIMATED_DAYS_MAX,
} from "@/lib/stripeWebhookState";
import { claimBlockedCheckoutOrderRefund } from "@/lib/orderRefundClaimAuthority";
import {
  orderRefundProviderEvidence,
  type OrderRefundProviderEvidence,
  type OrderRefundRecordResult,
} from "@/lib/orderRefundRecordAuthority";
import { finalizeBlockedCheckoutOrderRefund } from "@/lib/orderRefundFinalization";
import { resolveOrderRefundProviderOutcome } from "@/lib/orderRefundProviderReconciliation";
import { markOrderRefundClaimAmbiguous } from "@/lib/orderRefundReconciliationAuthority";
import { bindBlockedCheckoutTransfer } from "@/lib/blockedCheckoutTransferAuthority";
import { resolveCheckoutPaymentIntentRefs } from "@/lib/checkoutPaymentIntentRefs";
import {
  applySignedDisputeWebhook,
  applySignedRefundWebhook,
} from "@/lib/orderPaymentSignedWebhook";
export const runtime = "nodejs";
export const maxDuration = 60;

const STRIPE_WEBHOOK_BODY_MAX_BYTES = 1024 * 1024;
const STRIPE_WEBHOOK_RETRY_AFTER_SECONDS = 30;

type CheckoutSessionShippingDetails = {
  shipping_details?: {
    address?: Record<string, string | null> | null;
  } | null;
};

function checkoutSessionShippingAddress(session: Stripe.Checkout.Session) {
  return (session as Stripe.Checkout.Session & CheckoutSessionShippingDetails).shipping_details?.address ?? null;
}

async function listAllCheckoutSessionLineItems(sessionId: string): Promise<CheckoutStockRestoreLineItem[]> {
  const lineItems: CheckoutStockRestoreLineItem[] = [];
  let startingAfter: string | undefined;

  do {
    const page = await stripe.checkout.sessions.listLineItems(sessionId, {
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.price.product"],
    });
    lineItems.push(...(page.data as CheckoutStockRestoreLineItem[]));
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);

  return lineItems;
}

async function checkoutSessionPaymentIntentRefs(session: Stripe.Checkout.Session) {
  return resolveCheckoutPaymentIntentRefs(session, {
    retrievePaymentIntent: (paymentIntentId, params) =>
      stripe.paymentIntents.retrieve(paymentIntentId, params),
    retrieveCharge: (chargeId, params) =>
      stripe.charges.retrieve(chargeId, params),
  });
}

const STRIPE_DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);
const BLOCKED_CHECKOUT_REVIEW_MARKER = "Order was held for staff review.";

function blockedCheckoutReviewPrefix(reason: string) {
  return `${reason} ${BLOCKED_CHECKOUT_REVIEW_MARKER}`;
}

function blockedCheckoutReviewReason(reviewNote: string | null | undefined) {
  if (!reviewNote) return null;
  const markerIndex = reviewNote.indexOf(BLOCKED_CHECKOUT_REVIEW_MARKER);
  if (markerIndex < 0) return null;
  const reason = reviewNote.slice(0, markerIndex).trim();
  return reason.length > 0 ? reason : null;
}

function orderPostPaymentSideEffectsBlocked(order: {
  sellerRefundId?: string | null;
  paymentRefundBlocked?: boolean | null;
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
}) {
  return (
    orderHasRefundLedger(order) ||
    Boolean(order.reviewNeeded && order.reviewNote?.includes(BLOCKED_CHECKOUT_REVIEW_MARKER))
  );
}

function blockedCheckoutRefundRetryReason(order: {
  sellerRefundId?: string | null;
  sellerRefundLockedAt?: Date | null;
  refundClaimId?: string | null;
  refundClaimSource?: string | null;
  refundClaimSourceId?: string | null;
  paymentRefundBlocked?: boolean | null;
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
}, eventId: string) {
  if (!order.reviewNeeded) return null;
  const reason = blockedCheckoutReviewReason(order.reviewNote);
  if (!reason) return null;
  if (order.paymentRefundBlocked) return null;
  if (order.refundClaimId) {
    return order.sellerRefundId === REFUND_LOCK_SENTINEL
      && order.refundClaimSource === "BLOCKED_CHECKOUT"
      && order.refundClaimSourceId === eventId
      ? reason
      : null;
  }
  if (!order.sellerRefundId) return reason;
  if (isStaleRefundLock({
    sellerRefundId: order.sellerRefundId,
    sellerRefundLockedAt: order.sellerRefundLockedAt ?? null,
  })) {
    return reason;
  }
  return null;
}

function blockedCheckoutRefundStillInProgress(order: {
  sellerRefundId?: string | null;
  sellerRefundLockedAt?: Date | null;
  refundClaimId?: string | null;
  paymentRefundBlocked?: boolean | null;
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
}) {
  return Boolean(
    order.reviewNeeded &&
      blockedCheckoutReviewReason(order.reviewNote) &&
      !order.paymentRefundBlocked &&
      (
        Boolean(order.refundClaimId) ||
        (
          order.sellerRefundId === REFUND_LOCK_SENTINEL &&
          !isStaleRefundLock({
            sellerRefundId: order.sellerRefundId,
            sellerRefundLockedAt: order.sellerRefundLockedAt ?? null,
          })
        )
      ),
  );
}

export async function POST(req: Request) {
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;

  if (!secret) {
    Sentry.captureMessage("Stripe webhook secret is not configured", {
      level: "fatal",
      tags: { source: "stripe_webhook_config" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "config", status: HTTP_STATUS.SERVICE_UNAVAILABLE });
    return NextResponse.json(
      { error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
  if (!signature) {
    Sentry.captureMessage("Stripe webhook signature header missing", {
      level: "warning",
      tags: { source: "stripe_webhook_signature" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "signature", status: HTTP_STATUS.BAD_REQUEST });
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  let body = "";
  try {
    body = await readBoundedText(req, STRIPE_WEBHOOK_BODY_MAX_BYTES);
  } catch (err) {
    if (isRequestBodyTooLargeError(err)) {
      Sentry.captureMessage("Stripe webhook payload is too large", {
        level: "warning",
        tags: { source: "stripe_webhook_payload" },
        extra: { maxBytes: err.maxBytes },
      });
      await recordWebhookFailureSpike({
        webhook: "stripe",
        kind: "payload",
        status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
      });
      return NextResponse.json({ error: "Payload too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    throw err;
  }

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: unknown) {
    console.error("Stripe webhook signature verification failed:", sanitizeEmailOutboxError(err));
    Sentry.captureException(err, { tags: { source: "stripe_webhook_signature" } });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "signature", status: HTTP_STATUS.BAD_REQUEST });
    return NextResponse.json({ error: "Invalid signature" }, { status: HTTP_STATUS.BAD_REQUEST });
  }

  const eventCreatedSeconds = stripeWebhookCreatedSeconds(
    (event as { created?: number | string | null }).created,
  );
  if (eventCreatedSeconds == null || isStaleStripeEvent(eventCreatedSeconds)) {
    Sentry.captureMessage("Stripe webhook event is too old", {
      level: "warning",
      tags: { source: "stripe_webhook_stale_event" },
      extra: { stripeEventId: event.id, stripeEventType: event.type, stripeEventCreated: event.created },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe",
      kind: "stale_event",
      status: HTTP_STATUS.BAD_REQUEST,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json({ error: "Stale Stripe event" }, { status: HTTP_STATUS.BAD_REQUEST });
  }
  const signedPaymentTime = new Date(eventCreatedSeconds * 1000);

  let reservation: Awaited<ReturnType<typeof beginStripeWebhookEvent>>;
  try {
    const sourceObjectId = (event.data.object as { id?: unknown }).id;
    if (typeof sourceObjectId !== "string" || sourceObjectId.length === 0) {
      throw new Error("Stripe webhook event object is missing its source id");
    }
    reservation = await beginStripeWebhookEvent(
      event.id,
      event.type,
      sourceObjectId,
    );
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "stripe_webhook_reservation" },
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe",
      kind: "reservation",
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json(
      { error: "Webhook temporarily unavailable" },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
    );
  }
  if (reservation.action === "processed") return NextResponse.json({ ok: true });
  if (reservation.action === "in_progress") {
    return NextResponse.json(
      { ok: false, status: reservation.action },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(STRIPE_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }
  const claimGeneration = reservation.claimGeneration;

  async function markCurrentStripeWebhookEventFailed(handlerErr: unknown) {
    try {
      await markStripeWebhookEventFailed(event.id, claimGeneration, handlerErr);
    } catch (markErr) {
      Sentry.captureException(markErr, {
        tags: { source: "stripe_webhook_mark_failed" },
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
    }
  }

  // Handle Stripe Workbench Snapshot thin events:
  // thin events only carry { id, object } (≤3 keys) in data.object. Keep the
  // signed envelope and copy in only the retrieved data.object after matching.
  const rawDataObj = (event as { data?: { object?: unknown } }).data?.object as
    | Record<string, unknown>
    | undefined;
  if (rawDataObj && isLikelyThinStripeEventObject(rawDataObj)) {
    try {
      const retrievedEvent = await stripe.events.retrieve(event.id);
      if (!retrievedStripeEventMatchesSignedEnvelope(event, retrievedEvent)) {
        Sentry.captureMessage("Stripe thin event retrieve mismatch", {
          level: "warning",
          tags: { source: "stripe_webhook_thin_event_mismatch" },
          extra: {
            signedEventId: event.id,
            signedEventType: event.type,
            signedEventCreated: event.created,
            signedApiVersion: event.api_version,
            retrievedEventId: retrievedEvent.id,
            retrievedEventType: retrievedEvent.type,
            retrievedEventCreated: retrievedEvent.created,
            retrievedApiVersion: retrievedEvent.api_version,
          },
        });
        await recordWebhookFailureSpike({
          webhook: "stripe",
          kind: "thin_event_mismatch",
          status: HTTP_STATUS.BAD_REQUEST,
          extra: { stripeEventId: event.id, stripeEventType: event.type },
        });
        await markCurrentStripeWebhookEventFailed(new Error("Retrieved thin event did not match signed envelope"));
        return NextResponse.json({ error: "Retrieved event mismatch" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      event = {
        ...event,
        data: {
          ...event.data,
          object: retrievedEvent.data.object,
        },
      } as Stripe.Event;
    } catch (retrieveErr) {
      console.error("Webhook: failed to retrieve full event:", sanitizeEmailOutboxError(retrieveErr));
      Sentry.captureException(retrieveErr, {
        tags: { source: "stripe_webhook_thin_event_retrieve" },
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
      await recordWebhookFailureSpike({
        webhook: "stripe",
        kind: "thin_event_retrieve",
        status: HTTP_STATUS.SERVICE_UNAVAILABLE,
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
      await markCurrentStripeWebhookEventFailed(retrieveErr);
      return NextResponse.json(
        { error: "Failed to retrieve event" },
        { status: HTTP_STATUS.SERVICE_UNAVAILABLE },
      );
    }
  }

  async function processIdempotentEvent(
    handler: () => Promise<NextResponse>,
    cleanup?: () => Promise<void>,
  ): Promise<NextResponse> {
    try {
      const response = await handler();
      await markStripeWebhookEventProcessed(event.id, claimGeneration);
      return response;
    } catch (handlerErr) {
      // A concurrent delivery may have committed the Order first. Preserve
      // this lease so the outer duplicate-session branch can complete this
      // distinct Stripe event instead of trying to complete a failed lease.
      if (!isStripeSessionUniqueConstraintError(handlerErr)) {
        await markCurrentStripeWebhookEventFailed(handlerErr);
      }
      throw handlerErr;
    } finally {
      if (cleanup) {
        try {
          await cleanup();
        } catch (cleanupErr) {
          Sentry.captureException(cleanupErr, {
            tags: { source: "stripe_webhook_cleanup" },
            extra: { stripeEventId: event.id, stripeEventType: event.type },
          });
        }
      }
    }
  }

  async function enqueueOrderPostPaymentSideEffects(
    sessionId: string,
    opts: { multiSellerCheckout?: boolean } = {},
  ) {
    const result = await readCheckoutPostpaymentProjection({
      eventId: event.id,
      claimGeneration,
      sessionId,
    });
    if (result.outcome === "blocked") return;
    const order = result.projection;
    const historicalItems = order.items;
    const sellerUserId = order.sellerUserId;
    const sellerName = historicalItems[0]?.snapshot.sellerName ?? order.sellerDisplayName;
    const firstItemTitle = historicalItems[0]?.snapshot.title ?? "an item";
    const buyerDisplayName = order.buyerName ?? "A buyer";

    await Promise.all([
      createNotification({
        userId: order.buyerId,
        type: "NEW_ORDER",
        title: "Order confirmed!",
        body: `Your order from ${sellerName} is being prepared`,
        link: `/dashboard/orders/${order.orderId}`,
        relatedUserId: sellerUserId,
        sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_CHECKOUT,
        sourceId: order.orderId,
      }),
      createNotification({
        userId: sellerUserId,
        type: "NEW_ORDER",
        title: "New sale! Congrats!",
        body: `${buyerDisplayName} purchased ${firstItemTitle}`,
        link: `/dashboard/sales/${order.orderId}`,
        relatedUserId: order.buyerId,
        sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_CHECKOUT,
        sourceId: order.orderId,
      }),
    ]);

    const inStockItems = new Map<string, {
      orderItemId: string;
      title: string;
      stockQuantity: number;
    }>();
    for (const item of historicalItems) {
      if (
        item.snapshot.listingType === "IN_STOCK"
        && item.currentStockQuantity != null
        && item.currentStockQuantity > 0
        && item.currentStockQuantity <= 2
      ) {
        const current = inStockItems.get(item.listingId);
        if (!current || item.id < current.orderItemId) {
          inStockItems.set(item.listingId, {
            orderItemId: item.id,
            title: item.snapshot.title,
            stockQuantity: item.currentStockQuantity,
          });
        }
      }
    }
    for (const sourceItem of inStockItems.values()) {
      await createNotification({
        userId: sellerUserId,
        type: "LOW_STOCK",
        title: `${sourceItem.title} is running low`,
        body: `Only ${sourceItem.stockQuantity} left in stock`,
        link: `/dashboard/inventory`,
        sourceType: NOTIFICATION_SOURCE_TYPES.CHECKOUT_LOW_STOCK,
        sourceId: sourceItem.orderItemId,
      });
    }

    const emailItems = historicalItems.map((item) => ({
      title: item.snapshot.title,
      quantity: item.quantity,
      priceCents: item.priceCents,
    }));
    const orderSummary = {
      id: order.orderId,
      itemsSubtotalCents: order.itemsSubtotalCents,
      shippingAmountCents: order.shippingAmountCents,
      taxAmountCents: order.taxAmountCents,
      giftWrapping: order.giftWrapping,
      giftWrappingPriceCents: order.giftWrappingPriceCents,
      currency: order.currency,
      estimatedDeliveryDate: order.estimatedDeliveryDate,
      processingDeadline: order.processingDeadline,
      shipToLine1: order.shipToLine1,
      shipToCity: order.shipToCity,
      shipToState: order.shipToState,
      shipToPostalCode: order.shipToPostalCode,
    };

    await sendOrderTransactionalEmailWithFallback({
      email: renderOrderConfirmedBuyerEmail({
        order: orderSummary,
        buyer: { name: order.buyerName, email: order.buyerEmail },
        seller: { displayName: sellerName },
        items: emailItems,
        multiSellerCheckout: opts.multiSellerCheckout === true,
      }),
      dedupKey: `order-confirmed-buyer:${order.orderId}`,
      userId: order.buyerId,
      source: "order_confirmed_buyer",
      extra: { orderId: order.orderId, buyerId: order.buyerId },
    });

    if (await shouldSendEmail(sellerUserId, "EMAIL_NEW_ORDER")) {
      await sendOrderTransactionalEmailWithFallback({
        email: renderOrderConfirmedSellerEmail({
          order: orderSummary,
          buyer: { name: buyerDisplayName },
          seller: { displayName: sellerName, email: order.sellerEmail },
          items: emailItems,
        }),
        dedupKey: `order-confirmed-seller:${order.orderId}`,
        userId: sellerUserId,
        preferenceKey: "EMAIL_NEW_ORDER",
        source: "order_confirmed_seller",
        extra: { orderId: order.orderId, sellerUserId },
      });
    }
    if (order.isFirstLegitimateSale) {
      await sendOrderTransactionalEmailWithFallback({
        email: renderFirstSaleCongratsEmail({
          seller: { displayName: sellerName, email: order.sellerEmail },
          order: orderSummary,
        }),
        dedupKey: `first-sale-congrats:${order.orderId}:${sellerUserId}`,
        userId: sellerUserId,
        source: "first_sale_congrats",
        extra: { orderId: order.orderId, sellerUserId },
      });
    }
  }

  async function sendOrderTransactionalEmailWithFallback({
    email,
    dedupKey,
    userId,
    preferenceKey,
    source,
    extra,
  }: {
    email: Pick<QueuedEmail, "to" | "subject" | "html">;
    dedupKey: string;
    userId?: string | null;
    preferenceKey?: QueuedEmail["preferenceKey"];
    source: QueuedEmail["templateName"];
    extra: Record<string, unknown>;
  }) {
    let enqueued: Awaited<ReturnType<typeof enqueueEmailOutboxOnce>>;
    try {
      enqueued = await enqueueEmailOutboxOnce({
        ...email,
        dedupKey,
        templateName: source,
        userId: userId ?? undefined,
        preferenceKey,
      });
    } catch (outboxError) {
      Sentry.captureException(outboxError, {
        tags: { source: "stripe_webhook_email_outbox", email: source },
        extra,
      });
      throw outboxError;
    }

    if (!enqueued.job || !enqueued.created) return;

    const claim = await prisma.emailOutbox.updateMany({
      where: { id: enqueued.job.id, status: "PENDING", attempts: 0 },
      data: {
        status: "PROCESSING",
        attempts: { increment: 1 },
        nextAttemptAt: null,
        lastError: null,
      },
    });
    if (claim.count !== 1) return;

    let directSendError: unknown;
    try {
      await sendRenderedEmail(email, {
        throwOnFailure: true,
        idempotencyKey: enqueued.job.dedupKey,
      });
    } catch (error) {
      directSendError = error;
      Sentry.captureException(error, {
        tags: { source: "stripe_webhook_email", email: source },
        extra,
      });
    }

    if (!directSendError) {
      try {
        await prisma.emailOutbox.updateMany({
          where: { id: enqueued.job.id, status: "PROCESSING" },
          data: {
            status: "SENT",
            sentAt: new Date(),
            nextAttemptAt: null,
            lastError: null,
          },
        });
      } catch (sentStateError) {
        Sentry.captureException(sentStateError, {
          tags: { source: "stripe_webhook_email_sent_state", email: source },
          extra,
        });
        throw sentStateError;
      }
      return;
    }

    try {
      const failureState = emailOutboxFailureState(enqueued.job.attempts + 1);
      await prisma.emailOutbox.updateMany({
        where: { id: enqueued.job.id, status: "PROCESSING" },
        data: {
          status: failureState.status,
          nextAttemptAt: failureState.nextAttemptAt,
          lastError: sanitizeEmailOutboxError(directSendError),
        },
      });
    } catch (fallbackError) {
      Sentry.captureException(fallbackError, {
        tags: { source: "stripe_webhook_email_outbox_failure_state", email: source },
        extra,
      });
    }
  }

  type CheckoutLineItem = CheckoutStockRestoreLineItem;

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      type StripeSession = {
        id: string;
        currency?: string | null;
        amount_total?: number | null;
        amount_subtotal?: number | null;
        shipping_cost?: { amount_total?: number | null; amount_subtotal?: number | null; shipping_rate?: unknown } | null;
        total_details?: { amount_tax?: number | null } | null;
        customer_details?: { email?: string | null; name?: string | null; address?: Record<string, string | null> | null } | null;
        shipping_details?: { address?: Record<string, string | null> | null } | null;
        payment_intent?: string | { id?: string; charges?: { data?: { id?: string; application_fee?: string | { id?: string }; transfer?: string | { id?: string } }[] } } | null;
        metadata?: Record<string, string>;
      };
      const session = event.data.object as StripeSession;
      const sessionId: string = session.id;
      let checkoutLockKey = session.metadata?.checkoutLockKey;
      const initialSessionMeta = (session.metadata ?? {}) as Record<string, string | undefined>;
      const initialCartSellerCount = parseOptionalNonNegativeInt(initialSessionMeta.cartSellerCount) ?? 0;
      const initialMultiSellerCheckout =
        initialSessionMeta.multiSellerCheckout === "true" || initialCartSellerCount > 1;

      return processIdempotentEvent(async () => {
      let existingBlockedCheckoutRetry: {
        id: string;
        retryReason: string;
        sellerUserIds: string[];
      } | null = null;

      // Idempotency
      const already = await prisma.order.findFirst({
        where: { stripeSessionId: sessionId },
        select: {
          id: true,
          sellerRefundId: true,
          sellerRefundLockedAt: true,
          refundClaimId: true,
          refundClaimSource: true,
          refundClaimSourceId: true,
          paymentRefundBlocked: true,
          reviewNeeded: true,
          reviewNote: true,
          sellerProfile: { select: { userId: true } },
        },
      });
      if (already) {
        const retryReason = blockedCheckoutRefundRetryReason(already, event.id);
        if (retryReason) {
          existingBlockedCheckoutRetry = {
            id: already.id,
            retryReason,
            sellerUserIds: already.sellerProfile?.userId
              ? [already.sellerProfile.userId]
              : [],
          };
        } else if (blockedCheckoutRefundStillInProgress(already)) {
          throw new Error("Blocked checkout automatic refund is still in progress.");
        } else {
          await releaseCheckoutLock(checkoutLockKey, sessionId);
          if (!orderPostPaymentSideEffectsBlocked(already)) {
            await enqueueOrderPostPaymentSideEffects(sessionId, {
              multiSellerCheckout: initialMultiSellerCheckout,
            });
          }
          return NextResponse.json({ ok: true });
        }
      }

      // Retrieve with expansions (line_items needed to derive quantities at payment time)
      const s = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.latest_charge.transfer", "shipping_cost.shipping_rate", "line_items.data.price.product"],
      });
      const sessionMeta = (s.metadata ?? {}) as Record<string, string | undefined>;
      checkoutLockKey = sessionMeta.checkoutLockKey ?? checkoutLockKey;
      const checkoutLineItems: CheckoutLineItem[] = await listAllCheckoutSessionLineItems(sessionId);

      // A completed event whose current session is not yet paid must not release
      // reserved stock. A later signed async-failure/expiry event or the fenced
      // repair worker owns restoration; reopening stock here can oversell while
      // the same Checkout Session is still capable of settling.
      if (s.payment_status !== "paid") {
        Sentry.captureMessage("Checkout completion retained stock for an unpaid session", {
          level: "warning",
          tags: { source: "stripe_checkout_completion_unpaid" },
          extra: { stripeEventId: event.id, stripeEventType: event.type, stripeSessionId: sessionId },
        });
        return NextResponse.json({ ok: true });
      }

      const chargedTotalCents = requireCheckoutChargedTotalCents(s.amount_total);

      // Stripe snapshots
      const currency: string = (s.currency || DEFAULT_CURRENCY).toLowerCase();
      const shippingAmountCents: number = s.shipping_cost?.amount_subtotal ?? 0;
      const shippingRateObj = (s.shipping_cost?.shipping_rate || null) as {
        display_name?: string;
        metadata?: Record<string, string>;
        carrier?: string;
        provider?: string;
        service?: string;
        service_level?: { name?: string };
      } | null;
      const shippingTitle: string | undefined = shippingRateObj?.display_name || undefined;
      const taxAmountCents: number = s.total_details?.amount_tax ?? 0;

      const buyerEmail: string | undefined = s.customer_details?.email || undefined;
      const buyerName: string | undefined = sessionMeta.quotedToName ?? s.customer_details?.name ?? undefined;
      const shipAddress = checkoutSessionShippingAddress(s);
      const shipToLine1 = sessionMeta.quotedToLine1 ?? shipAddress?.line1 ?? null;
      const shipToLine2 = sessionMeta.quotedToLine2 ?? shipAddress?.line2 ?? null;
      const shipToCity = sessionMeta.quotedToCity ?? shipAddress?.city ?? null;
      const shipToState = sessionMeta.quotedToState ?? shipAddress?.state ?? null;
      const shipToPostalCode = sessionMeta.quotedToPostalCode ?? shipAddress?.postal_code ?? null;
      const shipToCountry = sessionMeta.quotedToCountry ?? shipAddress?.country ?? "US";

      // Payment refs
      const {
        paymentIntentId,
        stripeChargeId,
        stripeApplicationFeeId,
        stripeTransferId,
      } = await checkoutSessionPaymentIntentRefs(s);

      const buyerId: string | undefined = sessionMeta.buyerId;
      // Quoted snapshot from metadata (typed on-site)
      const quotedShipToPostalCode = sessionMeta.quotedShipToPostalCode || sessionMeta.quotedToPostalCode || "";
      const quotedShipToState = sessionMeta.quotedShipToState || sessionMeta.quotedToState || "";
      const quotedShipToCity = sessionMeta.quotedShipToCity || sessionMeta.quotedToCity || "";
      const quotedShipToCountry = sessionMeta.quotedShipToCountry || sessionMeta.quotedToCountry || "";
      const quotedShippingAmountCents =
        parseOptionalNonNegativeInt(sessionMeta.quotedShippingAmountCents);

      // Gift options from metadata
      const giftNote: string | null = sessionMeta.giftNote || null;
      const giftWrapping: boolean = sessionMeta.giftWrapping === "true";
      const giftWrappingPriceCents = parseOptionalNonNegativeInt(sessionMeta.giftWrappingPriceCents);
      const itemsSubtotalCents = checkoutItemsSubtotalCents({
        lineItems: checkoutLineItems,
        metadataItemsSubtotalCents: parseOptionalNonNegativeInt(sessionMeta.itemsSubtotalCents),
        checkoutAmountSubtotalCents: s.amount_subtotal ?? null,
        giftWrappingPriceCents,
      });
      const cartSellerCount = parseOptionalNonNegativeInt(sessionMeta.cartSellerCount) ?? 0;
      const multiSellerCheckout = sessionMeta.multiSellerCheckout === "true" || cartSellerCount > 1;

      // Shippo IDs from metadata / selected shipping rate
      const shippoShipmentId: string | null = sessionMeta.shippoShipmentId || null;
      const selectedRateObjectId: string | null = sessionMeta.selectedRateObjectId || null;
      const shippoRateObjectId: string | null = normalizeShippoRateObjectId(
        selectedRateObjectId || shippingRateObj?.metadata?.objectId || null,
      );

      // estDays stored in shipping rate metadata at checkout time; default 7 if missing/out-of-range
      const rawEstDays = shippingRateObj?.metadata?.estDays;
      const estDays: number = parseBoundedPositiveInt(rawEstDays, 7, SHIPPING_ESTIMATED_DAYS_MAX);

      // Service info (best-effort)
      const shippingCarrier: string | null =
        (shippingRateObj?.carrier || shippingRateObj?.provider || null) ?? null;
      const shippingService: string | null =
        (shippingRateObj?.service || shippingRateObj?.service_level?.name || null) ?? null;
      async function refundBlockedCheckout(input: {
        orderId: string;
        reason: string;
        sellerUserIds: string[];
      }) {
        const reviewPrefix = blockedCheckoutReviewPrefix(input.reason);
        const { logSecurityEvent } = await import("@/lib/security");
        for (const sellerUserId of input.sellerUserIds) {
          logSecurityEvent("ownership_violation", {
            userId: sellerUserId,
            route: "/api/stripe/webhook",
            reason: input.reason,
          });
        }

        if (!paymentIntentId) {
          await prisma.order.update({
            where: { id: input.orderId },
            data: {
              reviewNeeded: true,
              reviewNote: `${reviewPrefix} Automatic refund could not be issued because the PaymentIntent ID was unavailable.`,
            },
          });
          Sentry.captureMessage("Blocked checkout missing PaymentIntent for automatic refund", {
            level: "warning",
            tags: { source: "stripe_webhook_blocked_checkout" },
            extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason },
          });
          return;
        }

        // A paid destination charge can briefly expose its PaymentIntent and
        // Charge before the associated transfer appears. Treating that
        // provider-consistency window as a disconnected seller would fund the
        // refund from Grainline while leaving the seller transfer intact.
        // Fail closed until the exact provider-derived transfer is available,
        // then bind it under this signed webhook generation before claiming
        // refund authority. A Stripe retry can safely replay the binding.
        if (!stripeChargeId || !stripeTransferId) {
          throw new Error(
            "Blocked checkout destination transfer is not yet available; retry the signed event.",
          );
        }
        await bindBlockedCheckoutTransfer({
          eventId: event.id,
          eventClaimGeneration: claimGeneration,
          sessionId,
          orderId: input.orderId,
          paymentIntentId,
          chargeId: stripeChargeId,
          transferId: stripeTransferId,
        });

        let refundId: string | null = null;
        let refundAmountCents: number | null = null;
        let refundIds: string[] = [];
        let refundProviderEvidence: OrderRefundProviderEvidence | null = null;
        let refundRecordResult: OrderRefundRecordResult | null = null;
        let retryBlockedCheckoutRefund = false;
        try {
          await releaseBlockedCheckoutLegacyRefundLock({
            eventId: event.id,
            eventClaimGeneration: claimGeneration,
            sessionId,
            orderId: input.orderId,
          });
          const currentOrder = await prisma.order.findUnique({
            where: { id: input.orderId },
            select: {
              sellerRefundId: true,
              paymentRefundBlocked: true,
              paymentOpenDisputeBlocked: true,
            },
          });
          if (!currentOrder) {
            Sentry.captureMessage("Blocked checkout order missing before automatic refund", {
              level: "warning",
              tags: { source: "stripe_webhook_blocked_checkout_missing_order" },
              extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason },
            });
            return;
          }
          if (
            orderHasRefundLedger(currentOrder)
            && currentOrder.sellerRefundId !== REFUND_LOCK_SENTINEL
          ) {
            await prisma.order.update({
              where: { id: input.orderId },
              data: {
                reviewNeeded: true,
                reviewNote: `${reviewPrefix} Automatic refund was skipped because a refund is already recorded for this order.`,
              },
            });
            return;
          }

          const disputeGuard = blockedCheckoutDisputeState({
            openDisputeBlocked: currentOrder.paymentOpenDisputeBlocked,
            reviewPrefix,
          });
          if (disputeGuard) {
            await prisma.order.update({
              where: { id: input.orderId },
              data: {
                reviewNeeded: disputeGuard.reviewNeeded,
                reviewNote: disputeGuard.reviewNote,
              },
            });
            Sentry.captureMessage("Blocked checkout automatic refund skipped for open Stripe dispute", {
              level: "warning",
              tags: { source: "stripe_webhook_blocked_checkout_dispute_guard" },
              extra: {
                stripeSessionId: sessionId,
                orderId: input.orderId,
                reason: input.reason,
                disputeId: disputeGuard.disputeId,
                disputeStatus: disputeGuard.disputeStatus,
              },
            });
            return;
          }

          refundAmountCents =
            chargedTotalCents;
          const refundClaim = await claimBlockedCheckoutOrderRefund({
            eventId: event.id,
            eventClaimGeneration: claimGeneration,
            sessionId,
            orderId: input.orderId,
            expectedAmountCents: refundAmountCents,
          });
          if (!refundClaim) {
            const conflictingOrder = await prisma.order.findUnique({
              where: { id: input.orderId },
              select: {
                sellerRefundId: true,
                paymentRefundBlocked: true,
              },
            });
            const hasRefund = conflictingOrder ? orderHasRefundLedger(conflictingOrder) : false;
            await prisma.order.updateMany({
              where: { id: input.orderId },
              data: {
                reviewNeeded: true,
                reviewNote: hasRefund
                  ? `${reviewPrefix} Automatic refund was skipped because another refund is already being processed or recorded for this order.`
                  : `${reviewPrefix} Automatic refund was skipped because refund or dispute state changed while processing; staff must reconcile this payment manually.`,
              },
            });
            return;
          }

          try {
            const refund = await resolveOrderRefundProviderOutcome(refundClaim);
            refundId = refund.primaryRefundId;
            refundIds = refund.refundIds;
            if (!refundId) {
              throw new Error(
                "Blocked checkout refund completed without a primary refund identifier.",
              );
            }

            refundProviderEvidence = orderRefundProviderEvidence(refund);
            refundRecordResult = await finalizeBlockedCheckoutOrderRefund({
              orderId: input.orderId,
              claim: refundClaim,
              evidence: refundProviderEvidence,
            });
            if (refundRecordResult.restoredActiveListingCount > 0) {
              revalidateListingSearchCaches();
              revalidateFeaturedMakerCaches();
            }

          } catch (refundError) {
            if (refundId) {
              Sentry.captureException(refundError, {
                tags: { source: "stripe_webhook_blocked_checkout_finalize_retry" },
                extra: {
                  stripeSessionId: sessionId,
                  orderId: input.orderId,
                  reason: input.reason,
                  refundId,
                  refundIds,
                  refundAmountCents,
                },
              });
              if (!refundProviderEvidence) {
                throw refundError;
              }
              try {
                refundRecordResult = await finalizeBlockedCheckoutOrderRefund({
                  orderId: input.orderId,
                  claim: refundClaim,
                  evidence: refundProviderEvidence,
                });
                if (refundRecordResult.restoredActiveListingCount > 0) {
                  revalidateListingSearchCaches();
                  revalidateFeaturedMakerCaches();
                }
              } catch (dbError) {
                Sentry.captureException(dbError, {
                  tags: { source: "stripe_webhook_blocked_checkout_finalize_retry_failed" },
                  extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason, refundId, refundIds },
                });
                throw dbError;
              }
            } else {
              retryBlockedCheckoutRefund = true;
              try {
                await markOrderRefundClaimAmbiguous({
                  claim: refundClaim,
                  reason: "BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS",
                });
              } catch (dbError) {
                Sentry.captureException(dbError, {
                  tags: { source: "stripe_webhook_blocked_checkout_refund_ambiguous_record_failed" },
                  extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason },
                });
                throw dbError;
              }
              Sentry.captureException(refundError, {
                tags: { source: "stripe_webhook_blocked_checkout_refund" },
                extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason },
              });
              throw refundError;
            }
          }
          if (!refundId || !refundRecordResult) {
            throw new Error(
              "Blocked checkout refund completed without durable refund authority.",
            );
          }
        } catch (refundError) {
          if (refundId || retryBlockedCheckoutRefund) {
            throw refundError;
          }
          await prisma.order.update({
            where: { id: input.orderId },
            data: {
              reviewNeeded: true,
              reviewNote: `${reviewPrefix} Automatic refund failed; staff must reconcile this payment manually.`,
            },
          });
          Sentry.captureException(refundError, {
            tags: { source: "stripe_webhook_blocked_checkout_refund" },
            extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason },
          });
        }
      }

      if (existingBlockedCheckoutRetry) {
        await releaseCheckoutLock(checkoutLockKey, sessionId);
        await refundBlockedCheckout({
          orderId: existingBlockedCheckoutRetry.id,
          reason: existingBlockedCheckoutRetry.retryReason,
          sellerUserIds: existingBlockedCheckoutRetry.sellerUserIds,
        });
        return NextResponse.json({ ok: true });
      }

      const cartId: string | undefined = sessionMeta.cartId;
      const sellerIdFromMeta: string | undefined = sessionMeta.sellerId;
      const listingId: string | undefined = sessionMeta.listingId;
      const reservationId: string | undefined = sessionMeta.checkoutReservationId;
      const checkoutMode = cartId && !listingId
        ? "cart"
        : listingId && !cartId
          ? "single"
          : null;

      if (!buyerId || !reservationId || !checkoutMode) {
        Sentry.captureMessage("Stripe checkout completion missing routing metadata", {
          level: "error",
          tags: { source: "stripe_webhook_checkout_metadata" },
          extra: {
            stripeSessionId: sessionId,
            hasBuyerId: Boolean(buyerId),
            hasReservationId: Boolean(reservationId),
            cartId: cartId ?? null,
            sellerId: sellerIdFromMeta ?? null,
            listingId: listingId ?? null,
          },
        });
        throw new Error("Stripe checkout completion missing routing metadata");
      }
      if (!paymentIntentId || !stripeChargeId || !stripeTransferId) {
        throw new Error(
          "Paid checkout payment references are not yet complete; retry the signed event.",
        );
      }

      const paidItems = checkoutLineItems.flatMap((lineItem) => {
        const product = typeof lineItem.price?.product === "object"
          ? lineItem.price.product
          : null;
        const paidListingId = product?.metadata?.listingId;
        if (!paidListingId) return [];
        const sourceKey = checkoutMode === "cart"
          ? product?.metadata?.cartItemId
          : paidListingId === listingId
            ? `single:${paidListingId}`
            : null;
        const quantity = lineItem.quantity;
        const unitAmountCents = lineItem.price?.unit_amount;
        if (
          !sourceKey
          || !Number.isSafeInteger(quantity)
          || !Number.isSafeInteger(unitAmountCents)
        ) {
          throw new Error("Paid checkout line item authority is incomplete");
        }
        return [{
          sourceKey,
          listingId: paidListingId,
          variantKey: product?.metadata?.variantKey ?? "",
          quantity: quantity as number,
          unitAmountCents: unitAmountCents as number,
        }];
      });
      if (paidItems.length === 0) {
        throw new Error("Paid checkout had no source-bound listing line items");
      }

      const createdOrder = await createOrderFromPaidCheckout({
        eventId: event.id,
        claimGeneration,
        reservationId,
        sessionId,
        paidAt: signedPaymentTime,
        provider: {
          currency,
          chargedTotalCents,
          itemsSubtotalCents,
          shippingTitle: shippingTitle ?? null,
          shippingAmountCents,
          taxAmountCents,
          buyerEmail: buyerEmail ?? null,
          buyerName: buyerName ?? null,
          shipToLine1,
          shipToLine2,
          shipToCity,
          shipToState,
          shipToPostalCode,
          shipToCountry: shipToCountry?.toUpperCase() ?? null,
          stripePaymentIntentId: paymentIntentId,
          stripeChargeId,
          stripeApplicationFeeId,
          stripeTransferId,
          shippingCarrier,
          shippingService,
          quotedToLine1: sessionMeta.quotedToLine1 ?? null,
          quotedToLine2: sessionMeta.quotedToLine2 ?? null,
          quotedToCity: quotedShipToCity || null,
          quotedToState: quotedShipToState || null,
          quotedToPostalCode: quotedShipToPostalCode || null,
          quotedToCountry: quotedShipToCountry?.toUpperCase() || null,
          quotedToName: sessionMeta.quotedToName ?? null,
          quotedToPhone: sessionMeta.quotedToPhone ?? null,
          quotedShippingAmountCents,
          shippoShipmentId,
          shippoRateObjectId,
          giftNote,
          giftWrapping,
          giftWrappingPriceCents: giftWrapping ? (giftWrappingPriceCents ?? 0) : 0,
          estDays,
          paidItems,
        },
      });

      await releaseCheckoutLock(checkoutLockKey, sessionId);
      if (createdOrder.outcome === "replayed") {
        return NextResponse.json({ ok: true });
      }
      if (createdOrder.listingVisibilityChanged) {
        revalidateListingSearchCaches();
        revalidateFeaturedMakerCaches();
      }
      if (createdOrder.invalidReason) {
        await refundBlockedCheckout({
          orderId: createdOrder.orderId,
          reason: createdOrder.invalidReason,
          sellerUserIds: [...createdOrder.invalidSellerUserIds],
        });
        return NextResponse.json({ ok: true });
      }

      await enqueueOrderPostPaymentSideEffects(sessionId, { multiSellerCheckout });
      return NextResponse.json({ ok: true });
      }, async () => {
        await releaseCheckoutLock(checkoutLockKey, sessionId);
      });
    }

    if (event.type === "account.updated") {
      return processIdempotentEvent(async () => {
        const account = event.data.object as {
          id: string;
          charges_enabled?: boolean;
          payouts_enabled?: boolean;
          details_submitted?: boolean;
          requirements?: { disabled_reason?: string | null } | null;
        };
        if (account.id) {
          // Stripe separates the ability to accept charges from payout and
          // verification state. Only mirror charges_enabled into Grainline's
          // buyer-facing purchase gate. Retrieve the live account first so
          // delayed snapshot events cannot restore stale checkout availability.
          const currentAccount = await stripe.accounts.retrieve(account.id);
          await mirrorStripeChargesEnabled({
            accountId: account.id,
            chargesEnabled: Boolean(currentAccount.charges_enabled),
            actorType: "webhook",
            actorId: event.id,
          });
        }
        return NextResponse.json({ received: true });
      });
    }

    if (event.type === "charge.refunded") {
      return processIdempotentEvent(async () => {
        const charge = event.data.object as {
          id?: string;
          amount_refunded?: number;
          currency?: string | null;
          refunds?: { data?: Array<{ id?: string; amount?: number; status?: string | null; created?: number | null; reason?: string | null }> };
        };
        if (
          !charge.id
          || typeof charge.amount_refunded !== "number"
          || !Number.isSafeInteger(charge.amount_refunded)
          || charge.amount_refunded <= 0
          || typeof charge.currency !== "string"
          || charge.currency.length === 0
        ) {
          throw new Error("Stripe charge.refunded webhook has an invalid signed source.");
        }
        const chargeId = charge.id;
        const amountRefundedCents = charge.amount_refunded;
        const chargeCurrency = charge.currency;
        await prisma.$transaction(async (tx) => {
          const latestRefund = latestSuccessfulRefund(charge.refunds?.data ?? []);
          await applySignedRefundWebhook(tx, {
            eventId: event.id,
            claimGeneration,
            chargeId,
            eventCreatedSeconds: event.created,
            amountRefundedCents,
            currency: chargeCurrency,
            refundId: latestRefund?.id ?? null,
            refundAmountCents: latestRefund?.amount ?? null,
            refundStatus: latestRefund?.status ?? null,
            refundCreatedSeconds: latestRefund?.created ?? null,
            refundReason: latestRefund?.reason ?? null,
          });
        });
        return NextResponse.json({ received: true });
      });
    }

    if (STRIPE_DISPUTE_EVENT_TYPES.has(event.type)) {
      return processIdempotentEvent(async () => {
        const dispute = event.data.object as {
          id?: string;
          charge?: string | { id?: string } | null;
          amount?: number | null;
          currency?: string | null;
          reason?: string | null;
          status?: string | null;
        };
        const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
        if (
          !chargeId
          || !dispute.id
          || typeof dispute.amount !== "number"
          || !Number.isSafeInteger(dispute.amount)
          || dispute.amount <= 0
          || typeof dispute.currency !== "string"
          || dispute.currency.length === 0
          || typeof dispute.status !== "string"
          || dispute.status.length === 0
        ) {
          throw new Error("Stripe dispute webhook has an invalid signed source.");
        }
        const disputeId = dispute.id;
        const disputeAmountCents = dispute.amount;
        const disputeCurrency = dispute.currency;
        const disputeStatus = dispute.status;
        const disputeResult = await prisma.$transaction(async (tx) => {
          const result = await applySignedDisputeWebhook(tx, {
            eventId: event.id,
            claimGeneration,
            chargeId,
            disputeId,
            eventCreatedSeconds: event.created,
            amountCents: disputeAmountCents,
            currency: disputeCurrency,
            reason: dispute.reason ?? null,
            status: disputeStatus,
          });
          if (result.notificationAuthorized) {
            await createNotificationOrThrow({
              userId: result.sellerUserId,
              type: "PAYMENT_DISPUTE",
              title: "Payment dispute opened",
              body: `Stripe reported a dispute for order ${result.orderId}.`,
              link: `/dashboard/sales/${result.orderId}`,
              dedupScope: `stripe-dispute:${disputeId}:created`,
              sourceType: NOTIFICATION_SOURCE_TYPES.ORDER_PAYMENT,
              sourceId: event.id,
              relatedUserId: result.buyerUserId,
            }, tx);
          }
          return result;
        });
        if (disputeResult.notificationAuthorized) {
          Sentry.captureMessage("Stripe dispute opened", {
            level: "warning",
            tags: {
              source: "stripe_dispute",
              disputeId,
              orderId: disputeResult.orderId,
            },
            extra: {
              stripeEventId: event.id,
              stripeChargeId: chargeId,
              sellerUserId: disputeResult.sellerUserId,
            },
          });
        }
        return NextResponse.json({ received: true });
      });
    }

    if (event.type === "payout.failed") {
      return processIdempotentEvent(async () => {
        await processStripePayoutFailedEvent(event, claimGeneration);
        return NextResponse.json({ received: true });
      });
    }

    if (event.type === "account.application.deauthorized") {
      return processIdempotentEvent(async () => {
        const deauthAccount = event.data.object as { id: string };
        if (deauthAccount.id) {
          const deauthorization = await applyStripeSellerDeauthorization({
            eventId: event.id,
            claimGeneration,
            accountId: deauthAccount.id,
            eventCreatedAt: signedPaymentTime,
          });
          if (deauthorization.publicVisibilityChanged) {
            revalidatePublicSellerVisibilityCaches();
          }
          if (deauthorization.sellerProfileId) {
            await expireOpenCheckoutSessionsForSeller({
              sellerId: deauthorization.sellerProfileId,
              stripeAccountId: deauthAccount.id,
              source: "stripe_deauthorized",
            });
          }
        }
        return NextResponse.json({ received: true });
      });
    }

    // CHECKOUT SESSION EXPIRED / ASYNC PAYMENT FAILED — restore reserved stock
    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      return processIdempotentEvent(async () => {
      const expiredSession = event.data.object as { id: string; metadata?: Record<string, string> };
      const expiredMeta = expiredSession.metadata ?? {};
      const expiredCartId = expiredMeta.cartId;
      const expiredSellerId = expiredMeta.sellerId;
      let expiredLineItems: CheckoutLineItem[] = [];

      // Retrieve Stripe line items before the DB transaction. The transaction
      // re-checks order existence after taking the advisory lock.
      if (expiredCartId && expiredSellerId) {
        try {
          const expiredS = await stripe.checkout.sessions.retrieve(expiredSession.id, {
            expand: ["line_items.data.price.product"],
          });
          expiredLineItems = (expiredS as { line_items?: { data?: CheckoutLineItem[] } }).line_items?.data ?? [];
        } catch (error) {
          Sentry.captureException(error, {
            tags: { source: "stripe_webhook_expired_line_items_retrieve" },
            extra: {
              stripeSessionId: expiredSession.id,
              cartId: expiredCartId,
              sellerId: expiredSellerId,
            },
          });
        }
      }

      await restoreUnorderedCheckoutStockOnce({
        eventId: event.id,
        claimGeneration,
        sessionId: expiredSession.id,
        metadata: expiredMeta,
        lineItems: expiredLineItems,
      });

      return NextResponse.json({ ok: true });
      });
    }

    await markStripeWebhookEventProcessed(event.id, claimGeneration);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Only stripeSessionId P2002s are duplicate webhook deliveries. Other unique
    // constraint failures are real bugs and must surface.
    const duplicateSession = isStripeSessionUniqueConstraintError(err);
    if (duplicateSession) {
      await markStripeWebhookEventProcessed(event.id, claimGeneration);
      return NextResponse.json({ ok: true });
    }
    console.error("Stripe webhook handler error:", sanitizeEmailOutboxError(err));
    Sentry.captureException(err, { tags: { source: "stripe_webhook" } });
    await recordWebhookFailureSpike({
      webhook: "stripe",
      kind: "handler",
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json({ error: "Webhook error" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
