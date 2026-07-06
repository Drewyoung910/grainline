// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
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
import { checkoutCompletionNeedsReview } from "@/lib/checkoutCompletionState";
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
import { parseSelectedVariantsMetadata } from "@/lib/stripeWebhookMetadata";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { sanitizeText, sanitizeUserName, truncateText } from "@/lib/sanitize";
import { logSystemActionOrThrow } from "@/lib/systemAudit";
import {
  lockCheckoutSessionMutation,
  markCheckoutStockReservationCompleted,
  restorableStockItemsFromLineItems,
  restoreReservedStockItems,
  restoreUnorderedCheckoutStockOnce,
  type CheckoutStockRestoreLineItem,
} from "@/lib/checkoutStockRestore";
import {
  blockingRefundLedgerWhere,
  blockingRefundOrDisputeLedgerWhere,
  isBlockingRefundLedgerEvent,
  orderHasRefundLedger,
} from "@/lib/refundRouteState";
import {
  blockingRefundOrLatestOpenDisputeLedgerExistsSql,
  latestOpenDisputeLedgerRowsSql,
} from "@/lib/refundLedgerSql";
import {
  REFUND_AMBIGUOUS_SENTINEL,
  REFUND_LOCK_SENTINEL,
  isStaleRefundLock,
} from "@/lib/refundLockState";
import { releaseStaleRefundLocks } from "@/lib/refundLocks";
import { createMarketplaceRefund, refundIdempotencyKeyBase } from "@/lib/marketplaceRefunds";
import { recordLocalRefundEvidence } from "@/lib/localRefundEvidence";
import { stripeWebhookCreatedSeconds } from "@/lib/stripeConnectV2";
import {
  revalidateFeaturedMakerCaches,
  revalidateListingSearchCaches,
  revalidatePublicSellerVisibilityCaches,
} from "@/lib/searchCache";
import { DEAUTHORIZED_SELLER_REVIEW_NOTE } from "@/lib/orderReviewHolds";
import {
  blockedCheckoutDisputeState,
  chargeDisputeLedgerState,
  chargeRefundLedgerState,
  checkoutItemsSubtotalCents,
  checkoutInvalidReasonState,
  checkoutPriceDriftState,
  disputeCaseAction,
  isLikelyThinStripeEventObject,
  isStaleStripeEvent,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  payoutFailureState,
  parseBoundedPositiveInt,
  parseOptionalNonNegativeInt,
  parsePositiveInt,
  retrievedStripeEventMatchesSignedEnvelope,
  SHIPPING_ESTIMATED_DAYS_MAX,
  shouldApplyDisputeWebhookSideEffects,
} from "@/lib/stripeWebhookState";
import { Prisma, type FulfillmentStatus } from "@prisma/client";


export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

const STRIPE_WEBHOOK_BODY_MAX_BYTES = 1024 * 1024;
const STRIPE_WEBHOOK_RETRY_AFTER_SECONDS = 30;

function snapshotText(value: string | null | undefined, maxLength: number) {
  return truncateText(sanitizeText(value ?? ""), maxLength);
}

function snapshotSellerName(value: string | null | undefined) {
  return sanitizeUserName(value ?? "", 100);
}

function paymentEventDescription(value: string | null | undefined) {
  const description = truncateText(sanitizeText(value ?? ""), 5000);
  return description || null;
}

type CheckoutBuyerPiiOrderData = {
  buyerEmail: string | null;
  buyerName: string | null;
  shipToLine1: string | null;
  shipToLine2: string | null;
  shipToCity: string | null;
  shipToState: string | null;
  shipToPostalCode: string | null;
  shipToCountry: string | null;
  quotedToName: string | null;
  quotedToPhone: string | null;
  quotedToCity: string | null;
  quotedToState: string | null;
  quotedToPostalCode: string | null;
  quotedToCountry: string | null;
  shippoShipmentId: string | null;
  shippoRateObjectId: string | null;
  giftNote: string | null;
  buyerDataPurgedAt: Date | null;
};

function checkoutBuyerPiiOrderData(input: {
  buyerInvalidReason: string | null;
  buyerEmail?: string | null;
  buyerName?: string | null;
  shipToLine1?: string | null;
  shipToLine2?: string | null;
  shipToCity?: string | null;
  shipToState?: string | null;
  shipToPostalCode?: string | null;
  shipToCountry?: string | null;
  quotedToName?: string | null;
  quotedToPhone?: string | null;
  quotedToCity?: string | null;
  quotedToState?: string | null;
  quotedToPostalCode?: string | null;
  quotedToCountry?: string | null;
  shippoShipmentId?: string | null;
  shippoRateObjectId?: string | null;
  giftNote?: string | null;
}): CheckoutBuyerPiiOrderData {
  if (input.buyerInvalidReason) {
    return {
      buyerEmail: null,
      buyerName: null,
      shipToLine1: null,
      shipToLine2: null,
      shipToCity: null,
      shipToState: null,
      shipToPostalCode: null,
      shipToCountry: null,
      quotedToName: null,
      quotedToPhone: null,
      quotedToCity: null,
      quotedToState: null,
      quotedToPostalCode: null,
      quotedToCountry: null,
      shippoShipmentId: null,
      shippoRateObjectId: null,
      giftNote: null,
      buyerDataPurgedAt: new Date(),
    };
  }

  return {
    buyerEmail: input.buyerEmail ?? null,
    buyerName: input.buyerName ?? null,
    shipToLine1: input.shipToLine1 ?? null,
    shipToLine2: input.shipToLine2 ?? null,
    shipToCity: input.shipToCity ?? null,
    shipToState: input.shipToState ?? null,
    shipToPostalCode: input.shipToPostalCode ?? null,
    shipToCountry: input.shipToCountry ?? null,
    quotedToName: input.quotedToName ?? null,
    quotedToPhone: input.quotedToPhone ?? null,
    quotedToCity: input.quotedToCity ?? null,
    quotedToState: input.quotedToState ?? null,
    quotedToPostalCode: input.quotedToPostalCode ?? null,
    quotedToCountry: input.quotedToCountry ?? null,
    shippoShipmentId: input.shippoShipmentId ?? null,
    shippoRateObjectId: input.shippoRateObjectId ?? null,
    giftNote: input.giftNote ?? null,
    buyerDataPurgedAt: null,
  };
}

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

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  const record = objectRecord(value);
  return typeof record?.id === "string" ? record.id : null;
}

async function checkoutSessionPaymentIntentRefs(session: Stripe.Checkout.Session) {
  const paymentIntent = session.payment_intent;
  let paymentIntentId = stripeObjectId(paymentIntent);
  let charge: Record<string, unknown> | null = null;

  if (typeof paymentIntent === "string") {
    const retrieved = await stripe.paymentIntents.retrieve(paymentIntent, {
      expand: ["latest_charge"],
    });
    paymentIntentId = retrieved.id;
    const latestCharge = retrieved.latest_charge;
    charge = typeof latestCharge === "string"
      ? objectRecord(await stripe.charges.retrieve(latestCharge))
      : objectRecord(latestCharge);
  } else {
    const paymentIntentRecord = objectRecord(paymentIntent);
    const latestCharge = paymentIntentRecord?.latest_charge;
    charge = typeof latestCharge === "string"
      ? objectRecord(await stripe.charges.retrieve(latestCharge))
      : objectRecord(latestCharge);

    if (!charge) {
      const chargesRecord = objectRecord(paymentIntentRecord?.charges);
      charge = Array.isArray(chargesRecord?.data)
        ? objectRecord(chargesRecord.data[0])
        : null;
    }
  }

  return {
    paymentIntentId,
    stripeChargeId: stripeObjectId(charge),
    stripeApplicationFeeId: stripeObjectId(charge?.application_fee),
    stripeTransferId: stripeObjectId(charge?.transfer),
  };
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
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
  paymentEvents?: Array<{ eventType?: string | null; status?: string | null }> | null;
}) {
  return (
    orderHasRefundLedger(order) ||
    Boolean(order.reviewNeeded && order.reviewNote?.includes(BLOCKED_CHECKOUT_REVIEW_MARKER))
  );
}

function blockedCheckoutRefundRetryReason(order: {
  sellerRefundId?: string | null;
  sellerRefundLockedAt?: Date | null;
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
  paymentEvents?: Array<{ eventType?: string | null; status?: string | null }> | null;
}) {
  if (!order.reviewNeeded) return null;
  const reason = blockedCheckoutReviewReason(order.reviewNote);
  if (!reason) return null;
  if (order.paymentEvents?.some(isBlockingRefundLedgerEvent)) return null;
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
  reviewNeeded?: boolean | null;
  reviewNote?: string | null;
  paymentEvents?: Array<{ eventType?: string | null; status?: string | null }> | null;
}) {
  return Boolean(
    order.reviewNeeded &&
      blockedCheckoutReviewReason(order.reviewNote) &&
      !order.paymentEvents?.some(isBlockingRefundLedgerEvent) &&
      order.sellerRefundId === REFUND_LOCK_SENTINEL &&
      !isStaleRefundLock({
        sellerRefundId: order.sellerRefundId,
        sellerRefundLockedAt: order.sellerRefundLockedAt ?? null,
      }),
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
  if (isStaleStripeEvent(eventCreatedSeconds)) {
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

  let reservation: Awaited<ReturnType<typeof beginStripeWebhookEvent>>;
  try {
    reservation = await beginStripeWebhookEvent(event.id, event.type);
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
  if (reservation === "processed") return NextResponse.json({ ok: true });
  if (reservation === "in_progress") {
    return NextResponse.json(
      { ok: false, status: reservation },
      { status: HTTP_STATUS.SERVICE_UNAVAILABLE, headers: { "Retry-After": String(STRIPE_WEBHOOK_RETRY_AFTER_SECONDS) } },
    );
  }

  async function markCurrentStripeWebhookEventFailed(handlerErr: unknown) {
    try {
      await markStripeWebhookEventFailed(event.id, handlerErr);
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
      await markStripeWebhookEventProcessed(event.id);
      return response;
    } catch (handlerErr) {
      await markCurrentStripeWebhookEventFailed(handlerErr);
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

  type OrderPaymentEventClient = {
    orderPaymentEvent: {
      createMany: (args: Prisma.OrderPaymentEventCreateManyArgs) => Promise<Prisma.BatchPayload>;
    };
  };

  async function recordOrderPaymentEvent(data: {
    orderId: string;
    stripeEventId: string;
    stripeObjectId?: string | null;
    stripeObjectType?: string | null;
    eventType: string;
    amountCents?: number | null;
    currency?: string | null;
    status?: string | null;
    reason?: string | null;
    description?: string | null;
    metadata?: Prisma.InputJsonObject;
  }, db: OrderPaymentEventClient = prisma): Promise<boolean> {
    const result = await db.orderPaymentEvent.createMany({
      data: {
        orderId: data.orderId,
        stripeEventId: data.stripeEventId,
        stripeObjectId: data.stripeObjectId ?? null,
        stripeObjectType: data.stripeObjectType ?? null,
        eventType: data.eventType,
        amountCents: data.amountCents ?? null,
        currency: (data.currency ?? DEFAULT_CURRENCY).toLowerCase(),
        status: data.status ?? null,
        reason: data.reason ?? null,
        description: paymentEventDescription(data.description),
        metadata: data.metadata ?? undefined,
      },
      skipDuplicates: true,
    });
    return result.count > 0;
  }

  async function enqueueOrderPostPaymentSideEffects(
    orderId: string,
    opts: { multiSellerCheckout?: boolean } = {},
  ) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerRefundId: true,
        reviewNeeded: true,
        reviewNote: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        giftWrapping: true,
        giftWrappingPriceCents: true,
        currency: true,
        estimatedDeliveryDate: true,
        processingDeadline: true,
        shipToLine1: true,
        shipToCity: true,
        shipToState: true,
        shipToPostalCode: true,
        buyer: { select: { name: true, email: true } },
        paymentEvents: {
          where: blockingRefundLedgerWhere(),
          take: 1,
          select: { eventType: true, status: true },
        },
        items: {
          select: {
            quantity: true,
            priceCents: true,
            listingId: true,
            listing: {
              select: {
                title: true,
                listingType: true,
                seller: {
                  select: {
                    id: true,
                    userId: true,
                    displayName: true,
                    user: { select: { email: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!order) return;
    if (orderPostPaymentSideEffectsBlocked(order)) return;

    const seller = order.items[0]?.listing.seller;
    const sellerUserId = seller?.userId;
    const sellerName = seller?.displayName ?? "Maker";
    const firstItemTitle = order.items[0]?.listing.title ?? "an item";
    const buyerDisplayName = order.buyer?.name ?? "A buyer";

    await Promise.all([
      order.buyerId
        ? createNotification({
            userId: order.buyerId,
            type: "NEW_ORDER",
            title: "Order confirmed!",
            body: `Your order from ${sellerName} is being prepared`,
            link: `/dashboard/orders/${order.id}`,
          })
        : Promise.resolve(),
      sellerUserId
        ? createNotification({
            userId: sellerUserId,
            type: "NEW_ORDER",
            title: "New sale! Congrats!",
            body: `${buyerDisplayName} purchased ${firstItemTitle}`,
            link: `/dashboard/sales/${order.id}`,
          })
        : Promise.resolve(),
    ]);

    if (sellerUserId) {
      const inStockItemTitles = new Map<string, string>();
      for (const item of order.items) {
        if (item.listing.listingType === "IN_STOCK") {
          inStockItemTitles.set(item.listingId, item.listing.title);
        }
      }
      const lowStockListings = inStockItemTitles.size
        ? await prisma.listing.findMany({
            where: {
              id: { in: [...inStockItemTitles.keys()] },
              stockQuantity: { gt: 0, lte: 2 },
            },
            select: { id: true, stockQuantity: true },
          })
        : [];
      for (const lowStockListing of lowStockListings) {
        await createNotification({
          userId: sellerUserId,
          type: "LOW_STOCK",
          title: `${inStockItemTitles.get(lowStockListing.id) ?? "A listing"} is running low`,
          body: `Only ${lowStockListing.stockQuantity ?? 0} left in stock`,
          link: `/dashboard/inventory`,
        });
      }
    }

    const emailItems = order.items.map((item) => ({
      title: item.listing.title,
      quantity: item.quantity,
      priceCents: item.priceCents,
    }));
    const orderSummary = {
      id: order.id,
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

    if (order.buyer?.email) {
      await sendOrderTransactionalEmailWithFallback({
        email: renderOrderConfirmedBuyerEmail({
          order: orderSummary,
          buyer: { name: order.buyer.name, email: order.buyer.email },
          seller: { displayName: sellerName },
          items: emailItems,
          multiSellerCheckout: opts.multiSellerCheckout === true,
        }),
        dedupKey: `order-confirmed-buyer:${order.id}`,
        userId: order.buyerId,
        source: "order_confirmed_buyer",
        extra: { orderId: order.id, buyerId: order.buyerId },
      });
    }

    if (sellerUserId && seller?.user?.email) {
      const sellerOrderCount = await prisma.order.count({
        where: { items: { some: { listing: { seller: { userId: sellerUserId } } } } },
      });
      if (await shouldSendEmail(sellerUserId, "EMAIL_NEW_ORDER")) {
        await sendOrderTransactionalEmailWithFallback({
          email: renderOrderConfirmedSellerEmail({
            order: orderSummary,
            buyer: { name: buyerDisplayName },
            seller: { displayName: sellerName, email: seller.user.email },
            items: emailItems,
          }),
          dedupKey: `order-confirmed-seller:${order.id}`,
          userId: sellerUserId,
          preferenceKey: "EMAIL_NEW_ORDER",
          source: "order_confirmed_seller",
          extra: { orderId: order.id, sellerUserId },
        });
      }
      if (sellerOrderCount === 1) {
        await sendOrderTransactionalEmailWithFallback({
          email: renderFirstSaleCongratsEmail({
            seller: { displayName: sellerName, email: seller.user.email },
            order: orderSummary,
          }),
          dedupKey: `first-sale-congrats:${order.id}:${sellerUserId}`,
          userId: sellerUserId,
          source: "first_sale_congrats",
          extra: { orderId: order.id, sellerUserId },
        });
      }
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

  async function lockChargeMutation(tx: Prisma.TransactionClient, chargeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(913337, hashtext(${chargeId}))`;
  }

  async function lockUserRowsForUpdate(tx: Prisma.TransactionClient, userIds: Array<string | null | undefined>) {
    for (const userId of [...new Set(userIds.filter((id): id is string => Boolean(id)))]) {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
    }
  }

  async function lockSellerProfileRowsForUpdate(tx: Prisma.TransactionClient, sellerProfileIds: Array<string | null | undefined>) {
    for (const sellerProfileId of [...new Set(sellerProfileIds.filter((id): id is string => Boolean(id)))]) {
      await tx.$queryRaw`SELECT id FROM "SellerProfile" WHERE id = ${sellerProfileId} FOR UPDATE`;
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
        buyerId: string | null;
        retryReason: string;
        sellerUserIds: string[];
      } | null = null;

      // Idempotency
      const already = await prisma.order.findFirst({
        where: { stripeSessionId: sessionId },
        select: {
          id: true,
          buyerId: true,
          sellerRefundId: true,
          sellerRefundLockedAt: true,
          reviewNeeded: true,
          reviewNote: true,
          paymentEvents: {
            where: blockingRefundLedgerWhere(),
            take: 1,
            select: { eventType: true, status: true },
          },
          items: {
            select: {
              listing: {
                select: {
                  seller: { select: { userId: true } },
                },
              },
            },
          },
        },
      });
      if (already) {
        const retryReason = blockedCheckoutRefundRetryReason(already);
        if (retryReason) {
          existingBlockedCheckoutRetry = {
            id: already.id,
            buyerId: already.buyerId,
            retryReason,
            sellerUserIds: [
              ...new Set(already.items.map((item) => item.listing.seller.userId).filter(Boolean)),
            ],
          };
        } else if (blockedCheckoutRefundStillInProgress(already)) {
          throw new Error("Blocked checkout automatic refund is still in progress.");
        } else {
          await releaseCheckoutLock(checkoutLockKey, sessionId);
          if (!orderPostPaymentSideEffectsBlocked(already)) {
            await enqueueOrderPostPaymentSideEffects(already.id, {
              multiSellerCheckout: initialMultiSellerCheckout,
            });
          }
          return NextResponse.json({ ok: true });
        }
      }

      // Retrieve with expansions (line_items needed to derive quantities at payment time)
      const s = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.latest_charge", "shipping_cost.shipping_rate", "line_items.data.price.product"],
      });
      const sessionMeta = (s.metadata ?? {}) as Record<string, string | undefined>;
      checkoutLockKey = sessionMeta.checkoutLockKey ?? checkoutLockKey;
      const checkoutLineItems: CheckoutLineItem[] = await listAllCheckoutSessionLineItems(sessionId);

      // Only process paid sessions — skip async/pending payments
      if (s.payment_status !== "paid") {
        await restoreUnorderedCheckoutStockOnce({ sessionId, metadata: sessionMeta, lineItems: checkoutLineItems });
        return NextResponse.json({ ok: true });
      }

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

      const reviewNeeded = checkoutCompletionNeedsReview({
        quotedPostalCode: quotedShipToPostalCode,
        actualPostalCode: shipToPostalCode,
        quotedState: quotedShipToState,
        actualState: shipToState,
        quotedCity: quotedShipToCity,
        actualCity: shipToCity,
        quotedCountry: quotedShipToCountry,
        actualCountry: shipToCountry,
        quotedShippingAmountCents,
        actualShippingAmountCents: shippingAmountCents,
      });

      // Service info (best-effort)
      const shippingCarrier: string | null =
        (shippingRateObj?.carrier || shippingRateObj?.provider || null) ?? null;
      const shippingService: string | null =
        (shippingRateObj?.service || shippingRateObj?.service_level?.name || null) ?? null;
      const shippingEta: Date | null = null; // Stripe Checkout doesn't give a concrete date

      const looksLikePickup =
        (shippingTitle?.toLowerCase().includes("pickup") ?? false) ||
        (!shipToLine1 && !shipToCity && !shipToPostalCode);
      const fulfillmentMethod = looksLikePickup ? "PICKUP" : "SHIPPING";
      const fulfillmentStatus: FulfillmentStatus = "PENDING";

      // Delivery date helper
      function calcDeliveryDates(maxProcessingDays: number, transitDays: number) {
        const MS_PER_DAY = 24 * 60 * 60 * 1000;
        const base = new Date();
        const processingDeadline = new Date(base.getTime() + maxProcessingDays * MS_PER_DAY);
        const estimatedDeliveryDate = new Date(
          processingDeadline.getTime() + (transitDays + 3) * MS_PER_DAY
        );
        return { processingDeadline, estimatedDeliveryDate };
      }

      async function refundBlockedCheckout(input: {
        orderId: string;
        reason: string;
        lineItems: CheckoutLineItem[];
        sellerUserIds: string[];
        buyerUserId: string | null;
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

        let refundId: string | null = null;
        let refundAmountCents: number | null = null;
        let refundIds: string[] = [];
        let refundStatuses: Array<string | null> = [];
        let refundRequiresManualTransferReconciliation = false;
        let refundRequiresManualFollowUp = false;
        let refundAccountingEvidence: Prisma.InputJsonObject | null = null;
        let retryBlockedCheckoutRefund = false;
        try {
          await releaseStaleRefundLocks(input.orderId);
          const currentOrder = await prisma.order.findUnique({
            where: { id: input.orderId },
            select: {
              sellerRefundId: true,
              paymentEvents: {
                where: blockingRefundLedgerWhere(),
                take: 1,
                select: { eventType: true, status: true },
              },
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
          if (orderHasRefundLedger(currentOrder)) {
            await prisma.order.update({
              where: { id: input.orderId },
              data: {
                reviewNeeded: true,
                reviewNote: `${reviewPrefix} Automatic refund was skipped because a refund is already recorded for this order.`,
              },
            });
            return;
          }

          const [latestDispute] =
            await prisma.$queryRaw<Array<{ status: string | null; stripeObjectId: string | null }>>`
              ${latestOpenDisputeLedgerRowsSql(Prisma.sql`${input.orderId}`)}
              LIMIT 1
            `;
          const disputeGuard = blockedCheckoutDisputeState({ latestDispute, reviewPrefix });
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

          const lockResult: number = await prisma.$executeRaw`
            UPDATE "Order"
            SET "sellerRefundId" = ${REFUND_LOCK_SENTINEL},
                "sellerRefundLockedAt" = ${new Date()},
                "reviewNeeded" = true,
                "reviewNote" = ${`${reviewPrefix} Automatic refund is being processed because the maker account was not eligible to accept this order.`}
            WHERE id = ${input.orderId}
              AND "sellerRefundId" IS NULL
              AND NOT (${blockingRefundOrLatestOpenDisputeLedgerExistsSql(Prisma.sql`"Order".id`)})
          `;
          if (lockResult !== 1) {
            const conflictingOrder = await prisma.order.findUnique({
              where: { id: input.orderId },
              select: {
                sellerRefundId: true,
                paymentEvents: {
                  where: blockingRefundOrDisputeLedgerWhere(),
                  take: 2,
                  select: { eventType: true, status: true },
                },
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
            refundAmountCents = s.amount_total ?? itemsSubtotalCents + shippingAmountCents + (giftWrappingPriceCents ?? 0) + taxAmountCents;
            const refund = await createMarketplaceRefund({
              paymentIntentId,
              resolution: "FULL",
              amountCents: refundAmountCents,
              itemsSubtotalCents,
              shippingAmountCents,
              giftWrappingPriceCents,
              taxAmountCents,
              canReverseTransfer: Boolean(stripeTransferId),
              idempotencyKeyBase: refundIdempotencyKeyBase({
                scope: "blocked-checkout-refund",
                id: sessionId,
                resolution: "FULL",
                amountCents: refundAmountCents,
              }),
            });
            refundId = refund.primaryRefundId;
            refundIds = refund.refundIds;
            refundStatuses = refund.refundStatuses;
            refundRequiresManualTransferReconciliation = refund.requiresManualTransferReconciliation;
            refundRequiresManualFollowUp = refund.requiresManualFollowUp;
            refundAccountingEvidence = refund.accountingEvidence;

            const transferNote = refund.requiresManualTransferReconciliation
              ? " Seller transfer reversal requires manual reconciliation."
              : "";
            const statusNote = refund.requiresManualFollowUp
              ? ` Stripe refund status requires manual follow-up: ${refund.refundStatuses.filter(Boolean).join(", ") || "provider pending"}.`
              : "";
            const issuedRefundAmountCents = refundAmountCents;

            const stockStatusRestoredCount = await prisma.$transaction(async (tx) => {
              const restoredCount = await restoreReservedStockItems(tx, restorableStockItemsFromLineItems(input.lineItems));
              const orderUpdate = await tx.order.updateMany({
                where: { id: input.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
                data: {
                  sellerRefundId: refundId,
                  sellerRefundAmountCents: refundAmountCents,
                  sellerRefundLockedAt: null,
                  reviewNeeded: true,
                  reviewNote: `${reviewPrefix} Automatic refund issued because the maker account was not eligible to accept this order.${transferNote}${statusNote}`,
                },
              });
              if (orderUpdate.count !== 1) {
                throw new Error("Blocked checkout refund lock was no longer held while recording Stripe refund.");
              }
              if (refundId) {
                await recordLocalRefundEvidence(tx, {
                  action: "BLOCKED_CHECKOUT_REFUND_RECORDED",
                  actorType: "webhook",
                  actorId: event.id,
                  orderId: input.orderId,
                  refundId,
                  refundIds,
                  amountCents: issuedRefundAmountCents,
                  currency,
                  status: refund.refundStatuses[0] ?? null,
                  reason: input.reason,
                  description: `${reviewPrefix} Automatic refund issued because the maker account was not eligible to accept this order.`,
                  metadata: {
                    stripeSessionId: sessionId,
                    stripeEventType: event.type,
                    checkoutReason: input.reason,
                    refundAccounting: refund.accountingEvidence,
                    requiresManualTransferReconciliation: refund.requiresManualTransferReconciliation,
                    requiresManualFollowUp: refund.requiresManualFollowUp,
                  },
                });
              }
              return restoredCount;
            });
            if (stockStatusRestoredCount > 0) {
              revalidateListingSearchCaches();
              revalidateFeaturedMakerCaches();
            }

            if (input.buyerUserId) {
              try {
                await createNotification({
                  userId: input.buyerUserId,
                  type: "NEW_ORDER",
                  title: "Payment refunded",
                  body: "This payment was refunded because the checkout was no longer eligible to complete.",
                  link: `/dashboard/orders/${input.orderId}`,
                });
              } catch (notificationError) {
                Sentry.captureException(notificationError, {
                  level: "warning",
                  tags: { source: "stripe_webhook_blocked_checkout_refund_notification" },
                  extra: {
                    stripeSessionId: sessionId,
                    orderId: input.orderId,
                    buyerUserId: input.buyerUserId,
                  },
                });
              }
            }
          } catch (refundError) {
            if (refundId) {
              Sentry.captureException(refundError, {
                tags: { source: "stripe_webhook_blocked_checkout_orphaned_after_stripe" },
                extra: {
                  stripeSessionId: sessionId,
                  orderId: input.orderId,
                  reason: input.reason,
                  refundId,
                  refundIds,
                  refundAmountCents,
                },
              });
              try {
                if (refundAmountCents == null) {
                  throw new Error("Blocked checkout orphan refund amount was unavailable.");
                }
                const orphanRefundId = refundId;
                const orphanReviewNote = `${reviewPrefix} ORPHANED REFUND: Stripe refund(s) ${refundIds.join(", ")} were created, but follow-up DB work failed. Manual reconciliation required.`;
                const orphanRefundAmountCents = refundAmountCents;
                await prisma.$transaction(async (tx) => {
                  const orphanRecord = await tx.order.updateMany({
                    where: { id: input.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
                    data: {
                      sellerRefundId: orphanRefundId,
                      sellerRefundAmountCents: orphanRefundAmountCents,
                      sellerRefundLockedAt: null,
                      reviewNeeded: true,
                      reviewNote: orphanReviewNote,
                    },
                  });
                  if (orphanRecord.count !== 1) {
                    throw new Error("Blocked checkout orphan refund record was not written.");
                  }
                  await recordLocalRefundEvidence(tx, {
                    action: "BLOCKED_CHECKOUT_REFUND_RECORDED",
                    actorType: "webhook",
                    actorId: event.id,
                    orderId: input.orderId,
                    refundId: orphanRefundId,
                    refundIds,
                    amountCents: orphanRefundAmountCents,
                    currency,
                    status: refundStatuses[0] ?? null,
                    reason: input.reason,
                    description: orphanReviewNote,
                    metadata: {
                      stripeSessionId: sessionId,
                      stripeEventType: event.type,
                      checkoutReason: input.reason,
                      orphanRecovery: true,
                      refundAccounting: refundAccountingEvidence,
                      requiresManualTransferReconciliation: refundRequiresManualTransferReconciliation,
                      requiresManualFollowUp: refundRequiresManualFollowUp,
                    },
                  });
                });
              } catch (dbError) {
                Sentry.captureException(dbError, {
                  tags: { source: "stripe_webhook_blocked_checkout_orphan_record_failed" },
                  extra: { stripeSessionId: sessionId, orderId: input.orderId, reason: input.reason, refundId, refundIds },
                });
                throw dbError;
              }
            } else {
              retryBlockedCheckoutRefund = true;
              try {
                await prisma.order.updateMany({
                  where: { id: input.orderId, sellerRefundId: REFUND_LOCK_SENTINEL },
                  data: {
                    sellerRefundId: REFUND_AMBIGUOUS_SENTINEL,
                    sellerRefundLockedAt: null,
                    reviewNeeded: true,
                    reviewNote: `${reviewPrefix} Automatic refund has an ambiguous Stripe outcome; staff must reconcile this payment manually before another refund is attempted.`,
                  },
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
          lineItems: checkoutLineItems,
          sellerUserIds: existingBlockedCheckoutRetry.sellerUserIds,
          buyerUserId: existingBlockedCheckoutRetry.buyerId,
        });
        return NextResponse.json({ ok: true });
      }

      // CART CHECKOUT
      const cartId: string | undefined = sessionMeta.cartId;
      const sellerIdFromMeta: string | undefined = sessionMeta.sellerId;

      if (cartId && buyerId) {
        // Build maps from Stripe's immutable line_items. This is the
        // authoritative source of what was actually charged.
        //
        // Prefer cartItemId, then listingId+variantKey. listingId-only is a
        // legacy fallback because multiple variants of one listing can share a
        // listingId.
        // The live cart may have been modified between session creation and webhook.
        const stripeLineItems: CheckoutLineItem[] = checkoutLineItems;
        type PaidItem = { listingId: string; cartItemId?: string; variantKey?: string; quantity: number; priceCents: number };
        const paidItems: PaidItem[] = [];
        for (const li of stripeLineItems) {
          const prod = typeof li.price?.product === "object" ? li.price?.product : null;
          const lid = prod?.metadata?.listingId;
          if (lid && li.quantity) {
            const paid: PaidItem = {
              listingId: lid,
              cartItemId: prod?.metadata?.cartItemId,
              variantKey: prod?.metadata?.variantKey,
              quantity: li.quantity,
              priceCents: li.price?.unit_amount ?? 0,
            };
            paidItems.push(paid);
          }
        }

        const cart = await prisma.cart.findUnique({
          where: { id: cartId },
          include: {
            items: {
              include: {
                listing: {
                  include: {
                    photos: { orderBy: { sortOrder: "asc" as const }, select: { url: true } },
                    seller: {
                      select: {
                        id: true,
                        userId: true,
                        displayName: true,
                        chargesEnabled: true,
                        stripeAccountId: true,
                        user: { select: { id: true, banned: true, deletedAt: true } },
                      },
                    },
                    variantGroups: { include: { options: true } },
                  },
                },
              },
              where: sellerIdFromMeta ? { listing: { sellerId: sellerIdFromMeta } } : undefined,
              orderBy: { createdAt: "asc" as const },
            },
          },
        });

        if (paidItems.length === 0) {
          Sentry.captureMessage("Paid cart checkout had no recoverable listing line items", {
            level: "error",
            tags: { source: "stripe_webhook_cart_paid_items_missing" },
            extra: { stripeSessionId: sessionId, cartId, sellerIdFromMeta },
          });
          await releaseCheckoutLock(checkoutLockKey, sessionId);
          throw new Error("Paid cart checkout had no recoverable listing line items");
        }

        const cartItems = cart?.items ?? [];
        const cartItemById = new Map(cartItems.map((item) => [item.id, item]));
        const cartItemsByListingVariant = new Map<string, typeof cartItems>();
        const cartItemsByListing = new Map<string, typeof cartItems>();
        for (const item of cartItems) {
          const listingVariantKey = `${item.listingId}:${item.variantKey ?? ""}`;
          const variantItems = cartItemsByListingVariant.get(listingVariantKey) ?? [];
          variantItems.push(item);
          cartItemsByListingVariant.set(listingVariantKey, variantItems);
          const listingItems = cartItemsByListing.get(item.listingId) ?? [];
          listingItems.push(item);
          cartItemsByListing.set(item.listingId, listingItems);
        }

        const paidListingIds = [...new Set(paidItems.map((item) => item.listingId))];
        const paidListings = await prisma.listing.findMany({
          where: { id: { in: paidListingIds } },
          include: {
            photos: { orderBy: { sortOrder: "asc" as const }, select: { url: true } },
            seller: {
              select: {
                id: true,
                userId: true,
                displayName: true,
                chargesEnabled: true,
                stripeAccountId: true,
                vacationMode: true,
                acceptingNewOrders: true,
                user: { select: { id: true, banned: true, deletedAt: true } },
              },
            },
            variantGroups: { include: { options: true } },
          },
        });
        const paidListingById = new Map(paidListings.map((listing) => [listing.id, listing]));
        const usedCartItemIds = new Set<string>();
        const takeCartItem = (paid: PaidItem) => {
          if (paid.cartItemId) {
            const cartItem = cartItemById.get(paid.cartItemId);
            if (cartItem && !usedCartItemIds.has(cartItem.id)) {
              usedCartItemIds.add(cartItem.id);
              return cartItem;
            }
          }
          const variantItems = cartItemsByListingVariant.get(`${paid.listingId}:${paid.variantKey ?? ""}`) ?? [];
          const variantItem = variantItems.find((item) => !usedCartItemIds.has(item.id));
          if (variantItem) {
            usedCartItemIds.add(variantItem.id);
            return variantItem;
          }
          const listingItems = cartItemsByListing.get(paid.listingId) ?? [];
          const listingItem = listingItems.find((item) => !usedCartItemIds.has(item.id));
          if (listingItem) {
            usedCartItemIds.add(listingItem.id);
            return listingItem;
          }
          return null;
        };
        const checkoutItems = paidItems
          .map((paid) => {
            const cartItem = takeCartItem(paid);
            const listing = cartItem?.listing ?? paidListingById.get(paid.listingId);
            return listing ? { paid, cartItem, listing } : null;
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);

        if (checkoutItems.length === 0) {
          Sentry.captureMessage("Paid cart checkout could not resolve any listing records", {
            level: "error",
            tags: { source: "stripe_webhook_cart_listings_missing" },
            extra: { stripeSessionId: sessionId, cartId, sellerIdFromMeta, paidListingIds },
          });
          await releaseCheckoutLock(checkoutLockKey, sessionId);
          throw new Error("Paid cart checkout could not resolve listing records");
        }
        if (checkoutItems.length !== paidItems.length) {
          const resolvedListingIds = new Set(checkoutItems.map((item) => item.paid.listingId));
          const unresolvedListingIds = paidItems
            .map((item) => item.listingId)
            .filter((listingId) => !resolvedListingIds.has(listingId));
          Sentry.captureMessage("Paid cart checkout resolved only part of the charged line items", {
            level: "error",
            tags: { source: "stripe_webhook_cart_partial_line_item_resolution" },
            extra: {
              stripeSessionId: sessionId,
              cartId,
              sellerIdFromMeta,
              paidItemCount: paidItems.length,
              resolvedItemCount: checkoutItems.length,
              unresolvedListingIds: unresolvedListingIds.slice(0, 10),
            },
          });
          throw new Error("Paid cart checkout could not resolve all listing records");
        }

        const maxProcessingDaysCart = Math.max(
          3,
          ...checkoutItems.map((item) =>
            item.listing.listingType === "IN_STOCK"
              ? (item.listing.shipsWithinDays ?? 1)
              : (item.listing.processingTimeMaxDays ?? 0)
          )
        );
        const { processingDeadline: cartProcessingDeadline, estimatedDeliveryDate: cartEstDelivery } =
          calcDeliveryDates(maxProcessingDaysCart, estDays);

        const createdCartOrder = await prisma.$transaction(async (tx) => {
          await lockCheckoutSessionMutation(tx, sessionId);
          let stockVisibilityChanged = false;

          const existingOrder = await tx.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: { id: true },
          });
          if (existingOrder) return null;

          const cartSellerIds = [...new Set(checkoutItems.map((item) => item.listing.sellerId))];
          const cartListingIds = [...new Set(checkoutItems.map((item) => item.listing.id))];
          await lockUserRowsForUpdate(tx, [buyerId]);
          await lockSellerProfileRowsForUpdate(tx, cartSellerIds);
          const cartSellerUserRefs = await tx.sellerProfile.findMany({
            where: { id: { in: cartSellerIds } },
            select: { userId: true },
          });
          await lockUserRowsForUpdate(tx, cartSellerUserRefs.map((seller) => seller.userId));

          const transactionBuyer = buyerId
            ? await tx.user.findUnique({
                where: { id: buyerId },
                select: { id: true, banned: true, deletedAt: true },
              })
            : null;
          const transactionSellers = await tx.sellerProfile.findMany({
            where: { id: { in: cartSellerIds } },
            select: {
              id: true,
              userId: true,
              chargesEnabled: true,
              stripeAccountId: true,
              vacationMode: true,
              acceptingNewOrders: true,
              user: { select: { id: true, banned: true, deletedAt: true } },
            },
          });
          const transactionListings = await tx.listing.findMany({
            where: { id: { in: cartListingIds } },
            select: { id: true, status: true, isPrivate: true, reservedForUserId: true },
          });
          const transactionSellerById = new Map(transactionSellers.map((seller) => [seller.id, seller]));
          const transactionListingById = new Map(transactionListings.map((listing) => [listing.id, listing]));
          const cartInvalidState = checkoutInvalidReasonState({
            buyer: transactionBuyer,
            sellers: cartSellerIds.map((sellerId) => transactionSellerById.get(sellerId)),
            listings: cartListingIds.map((listingId) => transactionListingById.get(listingId)),
            buyerUserId: buyerId,
          });
          const cartBuyerPii = checkoutBuyerPiiOrderData({
            buyerInvalidReason: cartInvalidState.buyerInvalidReason,
            buyerEmail,
            buyerName,
            shipToLine1,
            shipToLine2,
            shipToCity,
            shipToState,
            shipToPostalCode,
            shipToCountry,
            quotedToName: sessionMeta.quotedToName,
            quotedToPhone: sessionMeta.quotedToPhone,
            quotedToCity: quotedShipToCity || null,
            quotedToState: quotedShipToState || null,
            quotedToPostalCode: quotedShipToPostalCode || null,
            quotedToCountry: quotedShipToCountry || null,
            shippoShipmentId,
            shippoRateObjectId,
            giftNote,
          });

          const order = await tx.order.create({
            data: {
              buyerId: cartInvalidState.buyerUserId,
              paidAt: new Date(),
              stripeSessionId: sessionId,

              currency,
              itemsSubtotalCents,
              shippingTitle,
              shippingAmountCents,
              taxAmountCents,

              buyerEmail: cartBuyerPii.buyerEmail,
              buyerName: cartBuyerPii.buyerName,
              shipToLine1: cartBuyerPii.shipToLine1,
              shipToLine2: cartBuyerPii.shipToLine2,
              shipToCity: cartBuyerPii.shipToCity,
              shipToState: cartBuyerPii.shipToState,
              shipToPostalCode: cartBuyerPii.shipToPostalCode,
              shipToCountry: cartBuyerPii.shipToCountry,

              stripePaymentIntentId: paymentIntentId,
              stripeChargeId,
              stripeApplicationFeeId,
              stripeTransferId,

              fulfillmentMethod,
              fulfillmentStatus,

              // chosen service + quoted snapshot + review flag
              shippingCarrier,
              shippingService,
              shippingEta,

              quotedToName: cartBuyerPii.quotedToName,
              quotedToPhone: cartBuyerPii.quotedToPhone,
              quotedToCity: cartBuyerPii.quotedToCity,
              quotedToState: cartBuyerPii.quotedToState,
              quotedToPostalCode: cartBuyerPii.quotedToPostalCode,
              quotedToCountry: cartBuyerPii.quotedToCountry,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded: reviewNeeded || !!cartInvalidState.reason,
              reviewNote: cartInvalidState.reason
                ? blockedCheckoutReviewPrefix(cartInvalidState.reason)
                : reviewNeeded
                  ? "Address and/or quoted amount changed at Checkout."
                  : null,

              shippoShipmentId: cartBuyerPii.shippoShipmentId,
              shippoRateObjectId: cartBuyerPii.shippoRateObjectId,

              processingDeadline: cartProcessingDeadline,
              estimatedDeliveryDate: cartEstDelivery,

              giftNote: cartBuyerPii.giftNote,
              giftWrapping,
              giftWrappingPriceCents,
              buyerDataPurgedAt: cartBuyerPii.buyerDataPurgedAt,
            },
          });
          await logSystemActionOrThrow({
            client: tx,
            actorType: "webhook",
            actorId: event.id,
            action: "STRIPE_CHECKOUT_ORDER_CREATED",
            targetType: "ORDER",
            targetId: order.id,
            reason: cartInvalidState.reason ?? null,
            metadata: {
              stripeEventType: event.type,
              stripeSessionId: sessionId,
              stripePaymentIntentId: paymentIntentId ?? null,
              stripeChargeId: stripeChargeId ?? null,
              checkoutMode: "cart",
              reviewNeeded: reviewNeeded || Boolean(cartInvalidState.reason),
              invalidReason: cartInvalidState.reason ?? null,
              itemCount: checkoutItems.length,
              currency,
              itemsSubtotalCents,
              shippingAmountCents,
              taxAmountCents,
            },
          });

          for (const checkoutItem of checkoutItems) {
            const { paid, cartItem, listing } = checkoutItem;
            const orderQuantity = paid.quantity;
            const orderPriceCents = paid.priceCents;
            const priceDrift = checkoutPriceDriftState({
              stripeUnitAmountCents: paid.priceCents,
              expectedUnitAmountCents: cartItem?.priceCents ?? listing.priceCents,
              checkoutPriceVersion: cartItem?.priceVersion ?? null,
              currentPriceVersion: listing.priceVersion,
            });
            if (priceDrift) {
              Sentry.captureMessage("Stripe checkout line price drift detected", {
                level: "warning",
                tags: { source: "stripe_webhook_price_drift", checkoutMode: "cart" },
                extra: {
                  stripeSessionId: sessionId,
                  cartId,
                  cartItemId: cartItem?.id ?? paid.cartItemId ?? null,
                  listingId: paid.listingId,
                  ...priceDrift,
                },
              });
            }

            // Resolve variant selections from cart item option IDs
            const variantSnapshot: { groupName: string; optionLabel: string; priceAdjustCents: number }[] = [];
            if (cartItem?.selectedVariantOptionIds?.length) {
              for (const optId of cartItem.selectedVariantOptionIds) {
                for (const g of (listing.variantGroups ?? [])) {
                  const opt = (g.options ?? []).find((o: { id: string }) => o.id === optId);
                  if (opt) {
                    variantSnapshot.push({
                      groupName: g.name,
                      optionLabel: (opt as { label: string }).label,
                      priceAdjustCents: (opt as { priceAdjustCents: number }).priceAdjustCents,
                    });
                  }
                }
              }
            }

            await tx.orderItem.create({
              data: {
                orderId: order.id,
                listingId: paid.listingId,
                quantity: orderQuantity,
                priceCents: orderPriceCents,
                listingSnapshot: {
                  title: snapshotText(listing.title, 200),
                  description: snapshotText(listing.description, 5000),
                  priceCents: orderPriceCents,
                  imageUrls: listing.photos?.map((p: { url: string }) => p.url) ?? [],
                  category: listing.category ?? null,
                  tags: listing.tags ?? [],
                  sellerName: snapshotSellerName(listing.seller?.displayName),
                  capturedAt: new Date().toISOString(),
                },
                selectedVariants: variantSnapshot.length > 0 ? variantSnapshot : undefined,
              },
            });

            // Stock was already decremented at checkout time (reservation).
            // Just check if we need to mark SOLD_OUT.
            let listingSearchCacheInvalidationNeeded = false;
            if (listing.listingType === "IN_STOCK") {
              const soldOutCount = await tx.$executeRaw`
                UPDATE "Listing"
                SET status = 'SOLD_OUT'
                WHERE id = ${paid.listingId}
                  AND "stockQuantity" <= 0
                  AND status = 'ACTIVE'
              `;
              listingSearchCacheInvalidationNeeded = Number(soldOutCount) > 0;
            }
            stockVisibilityChanged = stockVisibilityChanged || listingSearchCacheInvalidationNeeded;
          }

          await markCheckoutStockReservationCompleted(tx, {
            reservationId: sessionMeta.checkoutReservationId,
            sessionId,
          });

          const paidCartItemIds = [...usedCartItemIds];
          if (paidCartItemIds.length > 0) {
            await tx.cartItem.deleteMany({
              where: { cartId, id: { in: paidCartItemIds } },
            });
          } else {
            await tx.cartItem.deleteMany({
              where: sellerIdFromMeta
                ? { cartId, listing: { sellerId: sellerIdFromMeta, id: { in: paidListingIds } } }
                : { cartId, listingId: { in: paidListingIds } },
            });
          }

          return {
            id: order.id,
            invalidReason: cartInvalidState.reason,
            invalidSellerUserIds: cartInvalidState.sellerUserIds,
            buyerUserId: cartInvalidState.buyerUserId,
            listingSearchCacheInvalidationNeeded: stockVisibilityChanged,
          };
        });

        await releaseCheckoutLock(checkoutLockKey, sessionId);

        if (!createdCartOrder) return NextResponse.json({ ok: true });
        if (createdCartOrder.listingSearchCacheInvalidationNeeded) {
          revalidateListingSearchCaches();
          revalidateFeaturedMakerCaches();
        }

        if (createdCartOrder.invalidReason) {
          await refundBlockedCheckout({
            orderId: createdCartOrder.id,
            reason: createdCartOrder.invalidReason,
            lineItems: stripeLineItems,
            sellerUserIds: createdCartOrder.invalidSellerUserIds,
            buyerUserId: createdCartOrder.buyerUserId,
          });
          return NextResponse.json({ ok: true });
        }

        await enqueueOrderPostPaymentSideEffects(createdCartOrder.id, { multiSellerCheckout });

        return NextResponse.json({ ok: true });
      }

      // SINGLE LISTING CHECKOUT
      const listingId: string | undefined = sessionMeta.listingId;
      const quantity: number = parsePositiveInt(sessionMeta.quantity, 1);
      const priceCentsFromMeta: number | null =
        parseOptionalNonNegativeInt(sessionMeta.priceCents);

      if (listingId && buyerId) {
        const listingData = await prisma.listing.findUnique({
          where: { id: listingId },
          select: {
            priceCents: true,
            priceVersion: true,
            processingTimeMaxDays: true,
            listingType: true,
            stockQuantity: true,
            shipsWithinDays: true,
            // Snapshot fields
            title: true,
            description: true,
            category: true,
            tags: true,
            photos: { orderBy: { sortOrder: "asc" as const }, select: { url: true } },
            seller: {
              select: {
                id: true,
                userId: true,
                displayName: true,
                chargesEnabled: true,
                stripeAccountId: true,
                vacationMode: true,
                acceptingNewOrders: true,
                user: { select: { id: true, banned: true, deletedAt: true } },
              },
            },
          },
        });
        const price = priceCentsFromMeta ?? listingData?.priceCents ?? 0;
        const isInStock = listingData?.listingType === "IN_STOCK";
        const effectiveProcessingDays = isInStock
          ? (listingData?.shipsWithinDays ?? 1)
          : (listingData?.processingTimeMaxDays ?? 0);
        const maxProcessingDaysSingle = Math.max(isInStock ? 1 : 3, effectiveProcessingDays);
        const { processingDeadline: singleProcessingDeadline, estimatedDeliveryDate: singleEstDelivery } =
          calcDeliveryDates(maxProcessingDaysSingle, estDays);
        const selectedVariantsResult = parseSelectedVariantsMetadata(sessionMeta.selectedVariants);
        const selectedVariants = selectedVariantsResult.ok ? selectedVariantsResult.selectedVariants : undefined;
        if (!selectedVariantsResult.ok) {
          Sentry.captureMessage("Stripe selectedVariants metadata parse failed", {
            level: "warning",
            tags: {
              source: "stripe_webhook_selected_variants",
              parseError: selectedVariantsResult.error,
            },
            extra: {
              stripeSessionId: sessionId,
              listingId,
              metadataLength: selectedVariantsResult.metadataLength,
            },
          });
        }
        const singleLineItems: CheckoutLineItem[] = checkoutLineItems;
        const singlePaidLine = singleLineItems.find((lineItem) => {
          const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
          return product?.metadata?.listingId === listingId;
        });
        const singleOrderPriceCents = singlePaidLine?.price?.unit_amount ?? price;
        const singlePriceDrift = checkoutPriceDriftState({
          stripeUnitAmountCents: singlePaidLine?.price?.unit_amount ?? null,
          expectedUnitAmountCents: priceCentsFromMeta,
          checkoutPriceVersion: parseOptionalNonNegativeInt(sessionMeta.priceVersion),
          currentPriceVersion: listingData?.priceVersion ?? null,
        });
        if (singlePriceDrift) {
          Sentry.captureMessage("Stripe checkout line price drift detected", {
            level: "warning",
            tags: { source: "stripe_webhook_price_drift", checkoutMode: "single" },
            extra: {
              stripeSessionId: sessionId,
              listingId,
              ...singlePriceDrift,
            },
          });
        }

        const createdSingleOrder = await prisma.$transaction(async (tx) => {
          await lockCheckoutSessionMutation(tx, sessionId);

          const existingOrder = await tx.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: { id: true },
          });
          if (existingOrder) return null;

          await lockUserRowsForUpdate(tx, [buyerId]);
          const transactionListingRef = await tx.listing.findUnique({
            where: { id: listingId },
            select: { sellerId: true },
          });
          await lockSellerProfileRowsForUpdate(tx, [transactionListingRef?.sellerId]);
          const singleSellerUserRef = transactionListingRef?.sellerId
            ? await tx.sellerProfile.findUnique({
                where: { id: transactionListingRef.sellerId },
                select: { userId: true },
              })
            : null;
          await lockUserRowsForUpdate(tx, [singleSellerUserRef?.userId]);

          const transactionBuyer = buyerId
            ? await tx.user.findUnique({
                where: { id: buyerId },
                select: { id: true, banned: true, deletedAt: true },
              })
            : null;
          const transactionListing = await tx.listing.findUnique({
            where: { id: listingId },
            select: {
              id: true,
              status: true,
              isPrivate: true,
              reservedForUserId: true,
              seller: {
                select: {
                  id: true,
                  userId: true,
                  chargesEnabled: true,
                  stripeAccountId: true,
                  vacationMode: true,
                  acceptingNewOrders: true,
                  user: { select: { id: true, banned: true, deletedAt: true } },
                },
              },
            },
          });
          const singleInvalidState = checkoutInvalidReasonState({
            buyer: transactionBuyer,
            sellers: [transactionListing?.seller],
            listings: [transactionListing],
            buyerUserId: buyerId,
          });
          const singleBuyerPii = checkoutBuyerPiiOrderData({
            buyerInvalidReason: singleInvalidState.buyerInvalidReason,
            buyerEmail,
            buyerName,
            shipToLine1,
            shipToLine2,
            shipToCity,
            shipToState,
            shipToPostalCode,
            shipToCountry,
            quotedToName: sessionMeta.quotedToName,
            quotedToPhone: sessionMeta.quotedToPhone,
            quotedToCity: quotedShipToCity || null,
            quotedToState: quotedShipToState || null,
            quotedToPostalCode: quotedShipToPostalCode || null,
            quotedToCountry: quotedShipToCountry || null,
            shippoShipmentId,
            shippoRateObjectId,
            giftNote,
          });

          const order = await tx.order.create({
            data: {
              buyerId: singleInvalidState.buyerUserId,
              paidAt: new Date(),
              stripeSessionId: sessionId,

              currency,
              itemsSubtotalCents,
              shippingTitle,
              shippingAmountCents,
              taxAmountCents,

              buyerEmail: singleBuyerPii.buyerEmail,
              buyerName: singleBuyerPii.buyerName,
              shipToLine1: singleBuyerPii.shipToLine1,
              shipToLine2: singleBuyerPii.shipToLine2,
              shipToCity: singleBuyerPii.shipToCity,
              shipToState: singleBuyerPii.shipToState,
              shipToPostalCode: singleBuyerPii.shipToPostalCode,
              shipToCountry: singleBuyerPii.shipToCountry,

              stripePaymentIntentId: paymentIntentId,
              stripeChargeId,
              stripeApplicationFeeId,
              stripeTransferId,

              fulfillmentMethod,
              fulfillmentStatus,

              items: {
                create: [{
                  listingId,
                  quantity,
                  priceCents: singleOrderPriceCents,
                  listingSnapshot: {
                    title: snapshotText(listingData?.title, 200),
                    description: snapshotText(listingData?.description, 5000),
                    priceCents: singleOrderPriceCents,
                    imageUrls: listingData?.photos?.map((p: { url: string }) => p.url) ?? [],
                    category: listingData?.category ?? null,
                    tags: listingData?.tags ?? [],
                    sellerName: snapshotSellerName(listingData?.seller?.displayName),
                    capturedAt: new Date().toISOString(),
                  },
                  selectedVariants,
                }],
              },

              shippingCarrier,
              shippingService,
              shippingEta,

              quotedToName: singleBuyerPii.quotedToName,
              quotedToPhone: singleBuyerPii.quotedToPhone,
              quotedToCity: singleBuyerPii.quotedToCity,
              quotedToState: singleBuyerPii.quotedToState,
              quotedToPostalCode: singleBuyerPii.quotedToPostalCode,
              quotedToCountry: singleBuyerPii.quotedToCountry,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded: reviewNeeded || !!singleInvalidState.reason,
              reviewNote: singleInvalidState.reason
                ? blockedCheckoutReviewPrefix(singleInvalidState.reason)
                : reviewNeeded
                  ? "Address and/or quoted amount changed at Checkout."
                  : null,

              shippoShipmentId: singleBuyerPii.shippoShipmentId,
              shippoRateObjectId: singleBuyerPii.shippoRateObjectId,

              processingDeadline: singleProcessingDeadline,
              estimatedDeliveryDate: singleEstDelivery,

              giftNote: singleBuyerPii.giftNote,
              giftWrapping,
              giftWrappingPriceCents,
              buyerDataPurgedAt: singleBuyerPii.buyerDataPurgedAt,
            },
          });
          await logSystemActionOrThrow({
            client: tx,
            actorType: "webhook",
            actorId: event.id,
            action: "STRIPE_CHECKOUT_ORDER_CREATED",
            targetType: "ORDER",
            targetId: order.id,
            reason: singleInvalidState.reason ?? null,
            metadata: {
              stripeEventType: event.type,
              stripeSessionId: sessionId,
              stripePaymentIntentId: paymentIntentId ?? null,
              stripeChargeId: stripeChargeId ?? null,
              checkoutMode: "single",
              reviewNeeded: reviewNeeded || Boolean(singleInvalidState.reason),
              invalidReason: singleInvalidState.reason ?? null,
              listingId,
              quantity,
              currency,
              itemsSubtotalCents,
              shippingAmountCents,
              taxAmountCents,
            },
          });

          // Stock was already decremented at checkout time (reservation).
          // Just check if we need to mark SOLD_OUT.
          let listingSearchCacheInvalidationNeeded = false;
          if (isInStock) {
            const soldOutCount = await tx.$executeRaw`
              UPDATE "Listing"
              SET status = 'SOLD_OUT'
              WHERE id = ${listingId}
                AND "stockQuantity" <= 0
                AND status = 'ACTIVE'
            `;
            listingSearchCacheInvalidationNeeded = Number(soldOutCount) > 0;
          }

          await markCheckoutStockReservationCompleted(tx, {
            reservationId: sessionMeta.checkoutReservationId,
            sessionId,
          });

          return {
            id: order.id,
            invalidReason: singleInvalidState.reason,
            invalidSellerUserIds: singleInvalidState.sellerUserIds,
            buyerUserId: singleInvalidState.buyerUserId,
            listingSearchCacheInvalidationNeeded,
          };
        });

        await releaseCheckoutLock(checkoutLockKey, sessionId);

        if (!createdSingleOrder) return NextResponse.json({ ok: true });
        if (createdSingleOrder.listingSearchCacheInvalidationNeeded) {
          revalidateListingSearchCaches();
          revalidateFeaturedMakerCaches();
        }

        if (createdSingleOrder.invalidReason) {
          await refundBlockedCheckout({
            orderId: createdSingleOrder.id,
            reason: createdSingleOrder.invalidReason,
            lineItems: singleLineItems,
            sellerUserIds: createdSingleOrder.invalidSellerUserIds,
            buyerUserId: createdSingleOrder.buyerUserId,
          });
          return NextResponse.json({ ok: true });
        }

        await enqueueOrderPostPaymentSideEffects(createdSingleOrder.id, { multiSellerCheckout });

        return NextResponse.json({ ok: true });
      }

      Sentry.captureMessage("Stripe checkout completion missing routing metadata", {
        level: "error",
        tags: { source: "stripe_webhook_checkout_metadata" },
        extra: {
          stripeSessionId: sessionId,
          hasBuyerId: Boolean(buyerId),
          cartId: cartId ?? null,
          sellerId: sellerIdFromMeta ?? null,
          listingId: listingId ?? null,
        },
      });
      throw new Error("Stripe checkout completion missing routing metadata");
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
        if (charge.id) {
          await prisma.$transaction(async (tx) => {
            await lockChargeMutation(tx, charge.id!);
            const latestRefund = latestSuccessfulRefund(charge.refunds?.data ?? []);
            const existingOrder = await tx.order.findFirst({
              where: { stripeChargeId: charge.id },
              select: {
                id: true,
                currency: true,
                sellerRefundId: true,
                sellerRefundLockedAt: true,
                sellerRefundAmountCents: true,
                itemsSubtotalCents: true,
                shippingAmountCents: true,
                giftWrappingPriceCents: true,
                taxAmountCents: true,
              },
            });
            if (!existingOrder) {
              throw new Error("Stripe charge.refunded webhook could not find a Grainline order for charge.");
            }
            const refundLedger = chargeRefundLedgerState({
              chargeId: charge.id!,
              chargeCurrency: charge.currency,
              amountRefundedCents: charge.amount_refunded,
              latestRefund,
              fallbackRefundId: `external:${event.id}`,
              order: existingOrder,
            });

            const refundLedgerCreated = await recordOrderPaymentEvent({
              orderId: existingOrder.id,
              stripeEventId: event.id,
              stripeObjectId: refundLedger.ledger.stripeObjectId,
              stripeObjectType: "refund",
              eventType: "REFUND",
              amountCents: refundLedger.ledger.amountCents,
              currency: refundLedger.ledger.currency,
              status: refundLedger.ledger.status,
              reason: refundLedger.ledger.reason,
              description: refundLedger.ledger.description,
              metadata: refundLedger.ledger.metadata,
            }, tx);

            if (refundLedgerCreated && refundLedger.orderUpdate) {
              await tx.order.update({
                where: { id: existingOrder.id },
                data: refundLedger.orderUpdate,
              });
            }
            if (refundLedgerCreated) {
              await logSystemActionOrThrow({
                client: tx,
                actorType: "webhook",
                actorId: event.id,
                action: "STRIPE_REFUND_RECORDED",
                targetType: "ORDER",
                targetId: existingOrder.id,
                reason: refundLedger.ledger.reason ?? null,
                metadata: {
                  stripeEventType: event.type,
                  stripeChargeId: charge.id!,
                  stripeRefundId: refundLedger.ledger.stripeObjectId,
                  amountCents: refundLedger.ledger.amountCents,
                  currency: refundLedger.ledger.currency,
                  status: refundLedger.ledger.status,
                  hasOrderUpdate: Boolean(refundLedger.orderUpdate),
                },
              });
            }
          });
        }
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
        if (chargeId) {
          const notifySellerUserId = await prisma.$transaction(async (tx) => {
            await lockChargeMutation(tx, chargeId);
            const order = await tx.order.findFirst({
              where: { stripeChargeId: chargeId },
              select: {
                id: true,
                currency: true,
                buyerId: true,
                sellerRefundId: true,
                sellerRefundLockedAt: true,
                case: { select: { id: true, status: true } },
                items: {
                  take: 1,
                  select: {
                    listing: {
                      select: {
                        seller: {
                          select: { userId: true },
                        },
                      },
                    },
                  },
                },
              },
            });
            if (!order) {
              throw new Error("Stripe dispute webhook could not find a Grainline order for charge.");
            }
            const sellerUserId = order.items[0]?.listing.seller.userId;
            const disputeLedger = chargeDisputeLedgerState({
              chargeId,
              eventType: event.type,
              stripeEventCreated: event.created,
              dispute,
              orderCurrency: order.currency,
            });
            const latestDisputeEvents = dispute.id
              ? await tx.$queryRaw<Array<{
                  stripeEventId: string;
                  status: string | null;
                  stripeEventCreated: bigint | number | null;
                }>>`
                  SELECT
                    ope."stripeEventId",
                    ope."status",
                    COALESCE(
                      NULLIF(ope."metadata"->>'stripeEventCreated', '')::bigint,
                      EXTRACT(EPOCH FROM ope."createdAt")::bigint
                    ) AS "stripeEventCreated"
                  FROM "OrderPaymentEvent" ope
                  WHERE ope."orderId" = ${order.id}
                    AND ope."eventType" = 'DISPUTE'
                    AND ope."stripeObjectId" = ${dispute.id}
                  ORDER BY
                    COALESCE(
                      NULLIF(ope."metadata"->>'stripeEventCreated', '')::bigint,
                      EXTRACT(EPOCH FROM ope."createdAt")::bigint
                    ) DESC,
                    ope."createdAt" DESC,
                    ope.id DESC
                  LIMIT 1
                `
              : [];
            const latestDisputeEvent = latestDisputeEvents[0] ?? null;
            const applyDisputeSideEffects = shouldApplyDisputeWebhookSideEffects({
              currentEventCreated: event.created,
              currentStatus: disputeLedger.ledger.status,
              latestEvent: latestDisputeEvent,
            });
            const disputeLedgerCreated = await recordOrderPaymentEvent({
              orderId: order.id,
              stripeEventId: event.id,
              stripeObjectId: disputeLedger.ledger.stripeObjectId,
              stripeObjectType: "dispute",
              eventType: "DISPUTE",
              amountCents: disputeLedger.ledger.amountCents,
              currency: disputeLedger.ledger.currency,
              status: disputeLedger.ledger.status,
              reason: disputeLedger.ledger.reason,
              description: disputeLedger.ledger.description,
              metadata: disputeLedger.ledger.metadata,
            }, tx);
            const disputeSideEffectsApplied = disputeLedgerCreated && applyDisputeSideEffects;
            const orderUpdate = { ...disputeLedger.orderUpdate };
            if (disputeSideEffectsApplied) {
              if (
                "sellerRefundLockedAt" in orderUpdate &&
                order.sellerRefundId === REFUND_LOCK_SENTINEL &&
                !isStaleRefundLock({
                  sellerRefundId: order.sellerRefundId,
                  sellerRefundLockedAt: order.sellerRefundLockedAt,
                })
              ) {
                delete orderUpdate.sellerRefundLockedAt;
              }
              await tx.order.update({
                where: { id: order.id },
                data: orderUpdate,
              });
            }
            let disputeCaseActionName = "none";
            if (disputeSideEffectsApplied && event.type === "charge.dispute.created" && order.buyerId && sellerUserId) {
              const caseAction = disputeCaseAction({
                eventType: event.type,
                existingCase: order.case,
                dispute,
              });
              disputeCaseActionName = caseAction.action;
              if (caseAction.action === "update") {
                const caseUpdate = await tx.case.updateMany({
                  where: { id: caseAction.caseId, status: caseAction.expectedStatus },
                  data: {
                    status: caseAction.status,
                    resolution: null,
                    resolvedAt: null,
                    resolvedById: null,
                    buyerMarkedResolved: false,
                    sellerMarkedResolved: false,
                  },
                });
                if (caseUpdate.count !== 1) {
                  throw new Error("STRIPE_DISPUTE_CASE_UPDATE_CONFLICT");
                }
              } else if (caseAction.action === "create") {
                await tx.case.create({
                  data: {
                    orderId: order.id,
                    buyerId: order.buyerId,
                    sellerId: sellerUserId,
                    reason: "OTHER",
                    description: caseAction.description,
                    status: caseAction.status,
                    sellerRespondBy: caseAction.sellerRespondBy,
                  },
                });
              }
            }
            if (disputeLedgerCreated) {
              await logSystemActionOrThrow({
                client: tx,
                actorType: "webhook",
                actorId: event.id,
                action: "STRIPE_DISPUTE_RECORDED",
                targetType: "ORDER",
                targetId: order.id,
                reason: disputeLedger.ledger.reason ?? null,
                metadata: {
                  stripeEventType: event.type,
                  stripeChargeId: chargeId,
                  stripeDisputeId: disputeLedger.ledger.stripeObjectId,
                  amountCents: disputeLedger.ledger.amountCents,
                  currency: disputeLedger.ledger.currency,
                  status: disputeLedger.ledger.status,
                  caseAction: disputeCaseActionName,
                  hasOrderUpdate: disputeSideEffectsApplied && Object.keys(orderUpdate).length > 0,
                  disputeSideEffectsApplied,
                  latestRecordedStripeEventId: latestDisputeEvent?.stripeEventId ?? null,
                  latestRecordedStripeEventCreated: latestDisputeEvent?.stripeEventCreated != null
                    ? String(latestDisputeEvent.stripeEventCreated)
                    : null,
                },
              });
            }
            return disputeSideEffectsApplied && event.type === "charge.dispute.created" && sellerUserId
              ? { sellerUserId, orderId: order.id }
              : null;
          });
          if (notifySellerUserId) {
            await createNotification({
              userId: notifySellerUserId.sellerUserId,
              type: "PAYMENT_DISPUTE",
              title: "Payment dispute opened",
              body: `Stripe reported a dispute for order ${notifySellerUserId.orderId}.`,
              link: `/dashboard/sales/${notifySellerUserId.orderId}`,
              dedupScope: `stripe-dispute:${dispute.id ?? event.id}:created`,
            });
            Sentry.captureMessage("Stripe dispute opened", {
              level: "warning",
              tags: { source: "stripe_dispute", disputeId: dispute.id, orderId: notifySellerUserId.orderId },
              extra: {
                stripeEventId: event.id,
                stripeChargeId: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id,
                sellerUserId: notifySellerUserId.sellerUserId,
              },
            });
          }
        }
        return NextResponse.json({ received: true });
      });
    }

    if (event.type === "payout.failed") {
      return processIdempotentEvent(async () => {
        const accountId = (event as { account?: string }).account;
        const payout = event.data.object as Stripe.Payout;
        if (accountId) {
          const seller = await prisma.sellerProfile.findFirst({
            where: { stripeAccountId: accountId },
            select: { id: true, userId: true },
          });
          if (seller) {
            const payoutFailure = payoutFailureState(payout, event.id);
            const { stripePayoutId, ...payoutEventData } = payoutFailure.event;
            await prisma.sellerPayoutEvent.upsert({
              where: { stripePayoutId },
              create: {
                sellerProfileId: seller.id,
                stripePayoutId,
                ...payoutEventData,
              },
              update: payoutEventData,
            });
            await createNotification({
              userId: seller.userId,
              ...payoutFailure.notification,
            });
          }
        }
        return NextResponse.json({ received: true });
      });
    }

    if (event.type === "account.application.deauthorized") {
      return processIdempotentEvent(async () => {
        const deauthAccount = event.data.object as { id: string };
        if (deauthAccount.id) {
          const affectedSellers = await prisma.sellerProfile.findMany({
            where: { stripeAccountId: deauthAccount.id },
            select: { id: true, chargesEnabled: true },
          });
          const affectedSellerIds = affectedSellers.map((seller) => seller.id);
          await prisma.$transaction(async (tx) => {
            await tx.sellerProfile.updateMany({
              where: { stripeAccountId: deauthAccount.id },
              data: {
                chargesEnabled: false,
                stripeAccountId: null,
              },
            });
            for (const seller of affectedSellers) {
              await logSystemActionOrThrow({
                client: tx,
                actorType: "webhook",
                actorId: event.id,
                action: "STRIPE_ACCOUNT_DEAUTHORIZED",
                targetType: "SELLER_PROFILE",
                targetId: seller.id,
                metadata: {
                  stripeEventType: event.type,
                  stripeAccountId: deauthAccount.id,
                  previousChargesEnabled: seller.chargesEnabled,
                  chargesEnabled: false,
                  stripeAccountCleared: true,
                },
              });
            }
          });
          if (affectedSellerIds.length > 0) {
            revalidatePublicSellerVisibilityCaches();
            await prisma.order.updateMany({
              where: {
                reviewNeeded: false,
                fulfillmentStatus: { in: ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] },
                items: { some: { listing: { sellerId: { in: affectedSellerIds } } } },
              },
              data: {
                reviewNeeded: true,
                reviewNote: DEAUTHORIZED_SELLER_REVIEW_NOTE,
              },
            });
          }
          await mapWithConcurrency(affectedSellers, 3, (seller) =>
            expireOpenCheckoutSessionsForSeller({
              sellerId: seller.id,
              stripeAccountId: deauthAccount.id,
              source: "stripe_deauthorized",
            }),
          );
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
        sessionId: expiredSession.id,
        metadata: expiredMeta,
        lineItems: expiredLineItems,
      });

      return NextResponse.json({ ok: true });
      });
    }

    await markStripeWebhookEventProcessed(event.id);
    return NextResponse.json({ received: true });
  } catch (err) {
    // Only stripeSessionId P2002s are duplicate webhook deliveries. Other unique
    // constraint failures are real bugs and must surface.
    const p2002Target = err && typeof err === "object" && "meta" in err
      ? (err as { meta?: { target?: string[] | string } }).meta?.target
      : undefined;
    const duplicateSession =
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "P2002" &&
      (Array.isArray(p2002Target)
        ? p2002Target.includes("stripeSessionId")
        : typeof p2002Target === "string" && p2002Target.includes("stripeSessionId"));
    if (duplicateSession) {
      await markStripeWebhookEventProcessed(event.id);
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
