// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { mapWithConcurrency } from "@/lib/concurrency";
import { createNotification } from "@/lib/notifications";
import {
  renderOrderConfirmedBuyerEmail,
  renderOrderConfirmedSellerEmail,
  renderFirstSaleCongratsEmail,
} from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { expireOpenCheckoutSessionsForSeller } from "@/lib/checkoutSessionExpiry";
import { checkoutCompletionNeedsReview } from "@/lib/checkoutCompletionState";
import { recordWebhookFailureSpike } from "@/lib/webhookFailureSpike";
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/lib/stripeWebhookEvents";
import { parseSelectedVariantsMetadata } from "@/lib/stripeWebhookMetadata";
import {
  lockCheckoutSessionMutation,
  restorableStockItemsFromLineItems,
  restoreReservedStockItems,
  restoreUnorderedCheckoutStockOnce,
  type CheckoutStockRestoreLineItem,
} from "@/lib/checkoutStockRestore";
import { blockingRefundLedgerWhere, orderHasRefundLedger } from "@/lib/refundRouteState";
import {
  blockedCheckoutDisputeState,
  chargeDisputeLedgerState,
  chargeRefundLedgerState,
  checkoutPriceDriftState,
  disputeCaseAction,
  invalidCheckoutBuyerReason,
  invalidCheckoutSellerReason,
  isLikelyThinStripeEventObject,
  isStaleStripeEvent,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  payoutFailureState,
  parseOptionalNonNegativeInt,
  parsePositiveInt,
  retrievedStripeEventMatchesSignedEnvelope,
} from "@/lib/stripeWebhookState";
import type { FulfillmentStatus, Prisma } from "@prisma/client";


export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

const STRIPE_DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated",
]);

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  let event: Stripe.Event;

  if (!secret) {
    Sentry.captureMessage("Stripe webhook secret is not configured", {
      level: "fatal",
      tags: { source: "stripe_webhook_config" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "config", status: 503 });
    return NextResponse.json({ error: "Webhook temporarily unavailable" }, { status: 503 });
  }
  if (!signature) {
    Sentry.captureMessage("Stripe webhook signature header missing", {
      level: "warning",
      tags: { source: "stripe_webhook_signature" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Missing Stripe signature" }, { status: 400 });
  }

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: unknown) {
    console.error("Stripe webhook signature verification failed:", (err as { message?: string })?.message);
    Sentry.captureException(err, { tags: { source: "stripe_webhook_signature" } });
    Sentry.captureMessage("Stripe webhook signature verification failed", {
      level: "warning",
      tags: { source: "stripe_webhook_signature" },
    });
    await recordWebhookFailureSpike({ webhook: "stripe", kind: "signature", status: 400 });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  if (isStaleStripeEvent(event.created)) {
    Sentry.captureMessage("Stripe webhook event is too old", {
      level: "warning",
      tags: { source: "stripe_webhook_stale_event" },
      extra: { stripeEventId: event.id, stripeEventType: event.type, stripeEventCreated: event.created },
    });
    await recordWebhookFailureSpike({
      webhook: "stripe",
      kind: "stale_event",
      status: 400,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json({ error: "Stale Stripe event" }, { status: 400 });
  }

  const shouldProcess = await beginStripeWebhookEvent(event.id, event.type);
  if (!shouldProcess) return NextResponse.json({ ok: true });

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
  const rawDataObj = event.data.object as unknown as Record<string, unknown>;
  if (isLikelyThinStripeEventObject(rawDataObj)) {
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
          status: 400,
          extra: { stripeEventId: event.id, stripeEventType: event.type },
        });
        await markCurrentStripeWebhookEventFailed(new Error("Retrieved thin event did not match signed envelope"));
        return NextResponse.json({ error: "Retrieved event mismatch" }, { status: 400 });
      }
      event = {
        ...event,
        data: {
          ...event.data,
          object: retrievedEvent.data.object,
        },
      } as Stripe.Event;
    } catch (retrieveErr) {
      console.error("Webhook: failed to retrieve full event:", retrieveErr);
      Sentry.captureException(retrieveErr, {
        tags: { source: "stripe_webhook_thin_event_retrieve" },
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
      await recordWebhookFailureSpike({
        webhook: "stripe",
        kind: "thin_event_retrieve",
        status: 503,
        extra: { stripeEventId: event.id, stripeEventType: event.type },
      });
      await markCurrentStripeWebhookEventFailed(retrieveErr);
      return NextResponse.json({ error: "Failed to retrieve event" }, { status: 503 });
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
      upsert: (args: Prisma.OrderPaymentEventUpsertArgs) => Promise<unknown>;
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
  }, db: OrderPaymentEventClient = prisma) {
    await db.orderPaymentEvent.upsert({
      where: { stripeEventId: data.stripeEventId },
      update: {},
      create: {
        orderId: data.orderId,
        stripeEventId: data.stripeEventId,
        stripeObjectId: data.stripeObjectId ?? null,
        stripeObjectType: data.stripeObjectType ?? null,
        eventType: data.eventType,
        amountCents: data.amountCents ?? null,
        currency: (data.currency ?? "usd").toLowerCase(),
        status: data.status ?? null,
        reason: data.reason ?? null,
        description: data.description ?? null,
        metadata: data.metadata ?? undefined,
      },
    });
  }

  async function enqueueOrderPostPaymentSideEffects(orderId: string) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        currency: true,
        estimatedDeliveryDate: true,
        processingDeadline: true,
        shipToLine1: true,
        shipToCity: true,
        shipToState: true,
        shipToPostalCode: true,
        buyer: { select: { name: true, email: true } },
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
      currency: order.currency,
      estimatedDeliveryDate: order.estimatedDeliveryDate,
      processingDeadline: order.processingDeadline,
      shipToLine1: order.shipToLine1,
      shipToCity: order.shipToCity,
      shipToState: order.shipToState,
      shipToPostalCode: order.shipToPostalCode,
    };

    if (order.buyer?.email) {
      await enqueueEmailOutbox({
        ...renderOrderConfirmedBuyerEmail({
          order: orderSummary,
          buyer: { name: order.buyer.name, email: order.buyer.email },
          seller: { displayName: sellerName },
          items: emailItems,
        }),
        userId: order.buyerId ?? undefined,
        dedupKey: `order-confirmed-buyer:${order.id}`,
      });
    }

    if (sellerUserId && seller?.user?.email) {
      const sellerOrderCount = await prisma.order.count({
        where: { items: { some: { listing: { seller: { userId: sellerUserId } } } } },
      });
      await enqueueEmailOutbox({
        ...renderOrderConfirmedSellerEmail({
          order: orderSummary,
          buyer: { name: buyerDisplayName },
          seller: { displayName: sellerName, email: seller.user.email },
          items: emailItems,
        }),
        userId: sellerUserId,
        preferenceKey: "EMAIL_NEW_ORDER",
        dedupKey: `order-confirmed-seller:${order.id}`,
      });
      if (sellerOrderCount === 1) {
        await enqueueEmailOutbox({
          ...renderFirstSaleCongratsEmail({
            seller: { displayName: sellerName, email: seller.user.email },
            order: orderSummary,
          }),
          userId: sellerUserId,
          dedupKey: `first-sale:${sellerUserId}:${order.id}`,
        });
      }
    }
  }

  async function lockChargeMutation(tx: Prisma.TransactionClient, chargeId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(913337, hashtext(${chargeId}))`;
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

      return processIdempotentEvent(async () => {

      // Idempotency
      const already = await prisma.order.findFirst({
        where: { stripeSessionId: sessionId },
        select: { id: true },
      });
      if (already) {
        await releaseCheckoutLock(checkoutLockKey, sessionId);
        await enqueueOrderPostPaymentSideEffects(already.id);
        return NextResponse.json({ ok: true });
      }

      // Retrieve with expansions (line_items needed to derive quantities at payment time)
      const s = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.charges.data", "shipping_cost.shipping_rate", "line_items.data.price.product"],
      });
      const sessionMeta = (s.metadata ?? {}) as Record<string, string | undefined>;
      checkoutLockKey = sessionMeta.checkoutLockKey ?? checkoutLockKey;

      // Only process paid sessions — skip async/pending payments
      if (s.payment_status !== "paid") {
        const lineItems = (s as { line_items?: { data?: CheckoutLineItem[] } }).line_items?.data ?? [];
        await restoreUnorderedCheckoutStockOnce({ sessionId, metadata: sessionMeta, lineItems });
        return NextResponse.json({ ok: true });
      }

      // Stripe snapshots
      const currency: string = (s.currency || "usd").toLowerCase();
      const itemsSubtotalCents: number = s.amount_subtotal ?? 0;
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
      const shipToLine1 = sessionMeta.quotedToLine1 ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.line1 ?? null;
      const shipToLine2 = sessionMeta.quotedToLine2 ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.line2 ?? null;
      const shipToCity = sessionMeta.quotedToCity ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.city ?? null;
      const shipToState = sessionMeta.quotedToState ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.state ?? null;
      const shipToPostalCode = sessionMeta.quotedToPostalCode ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.postal_code ?? null;
      const shipToCountry = sessionMeta.quotedToCountry ?? (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address?.country ?? "US";

      // Payment refs
      type ExpandedPI = { id?: string; charges?: { data?: { id?: string; application_fee?: string | { id?: string }; transfer?: string | { id?: string } }[] } };
      const pi = typeof s.payment_intent === "string" ? null : (s.payment_intent as unknown as ExpandedPI | null);
      const paymentIntentId =
        typeof s.payment_intent === "string" ? s.payment_intent : pi?.id ?? null;
      const charge = pi?.charges?.data?.[0] ?? null;
      const stripeChargeId = charge?.id ?? null;
      const stripeApplicationFeeId =
        (typeof charge?.application_fee === "string"
          ? charge.application_fee
          : charge?.application_fee?.id) ?? null;
      const stripeTransferId =
        (typeof charge?.transfer === "string"
          ? charge.transfer
          : charge?.transfer?.id) ?? null;

      const buyerId: string | undefined = sessionMeta.buyerId;
      const buyerAccount = buyerId
        ? await prisma.user.findUnique({
            where: { id: buyerId },
            select: { id: true, banned: true, deletedAt: true },
          })
        : null;
      const invalidBuyerReason = buyerId ? invalidCheckoutBuyerReason(buyerAccount) : null;
      const orderBuyerId = invalidBuyerReason ? null : buyerId;

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
      const giftWrappingPriceCentsRaw = sessionMeta.giftWrappingPriceCents ? parseInt(sessionMeta.giftWrappingPriceCents, 10) : null;
      const giftWrappingPriceCents: number | null = giftWrappingPriceCentsRaw != null && Number.isFinite(giftWrappingPriceCentsRaw) ? giftWrappingPriceCentsRaw : null;

      // Shippo IDs from metadata / selected shipping rate
      const shippoShipmentId: string | null = sessionMeta.shippoShipmentId || null;
      const selectedRateObjectId: string | null = sessionMeta.selectedRateObjectId || null;
      const shippoRateObjectId: string | null = normalizeShippoRateObjectId(
        selectedRateObjectId || shippingRateObj?.metadata?.objectId || null,
      );

      // estDays stored in shipping rate metadata at checkout time; default 7 if missing
      const rawEstDays = shippingRateObj?.metadata?.estDays;
      const estDays: number = parsePositiveInt(rawEstDays, 7);

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
      }) {
        const reviewPrefix = `${input.reason} Order was held for staff review.`;
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

        try {
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

          const latestDispute = await prisma.orderPaymentEvent.findFirst({
            where: { orderId: input.orderId, eventType: "DISPUTE" },
            orderBy: { createdAt: "desc" },
            select: { status: true, stripeObjectId: true },
          });
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

          const refund = await stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              refund_application_fee: true,
              reverse_transfer: true,
            },
            { idempotencyKey: `blocked-checkout-refund:${sessionId}` },
          );

          await prisma.$transaction(async (tx) => {
            await restoreReservedStockItems(tx, restorableStockItemsFromLineItems(input.lineItems));
            await tx.order.update({
              where: { id: input.orderId },
              data: {
                sellerRefundId: refund.id,
                sellerRefundAmountCents: refund.amount ?? s.amount_total ?? null,
                sellerRefundLockedAt: null,
                reviewNeeded: true,
                reviewNote: `${reviewPrefix} Automatic refund issued because the maker account was not eligible to accept this order.`,
              },
            });
          });

          if (orderBuyerId) {
            await createNotification({
              userId: orderBuyerId,
              type: "NEW_ORDER",
              title: "Payment refunded",
              body: "This payment was refunded because the checkout was no longer eligible to complete.",
              link: `/dashboard/orders/${input.orderId}`,
            }).catch(() => {});
          }
        } catch (refundError) {
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
        const stripeLineItems: CheckoutLineItem[] = (s as { line_items?: { data?: CheckoutLineItem[] } }).line_items?.data ?? [];
        type PaidItem = { listingId: string; cartItemId?: string; variantKey?: string; quantity: number; priceCents: number };
        const paidByCartItemId = new Map<string, PaidItem>();
        const paidByListingVariant = new Map<string, PaidItem[]>();
        const paidByListing = new Map<string, PaidItem[]>();
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
            if (paid.cartItemId) paidByCartItemId.set(paid.cartItemId, paid);
            const variantKey = `${paid.listingId}:${paid.variantKey ?? ""}`;
            const variantArr = paidByListingVariant.get(variantKey) ?? [];
            variantArr.push(paid);
            paidByListingVariant.set(variantKey, variantArr);
            const listingArr = paidByListing.get(paid.listingId) ?? [];
            listingArr.push(paid);
            paidByListing.set(paid.listingId, listingArr);
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

        if (!cart || cart.items.length === 0) {
          await releaseCheckoutLock(checkoutLockKey, sessionId);
          return NextResponse.json({ ok: true });
        }

        const invalidCartSellers = new Map<string, { reason: string; sellerUserId: string }>();
        for (const item of cart.items) {
          const seller = item.listing.seller;
          const invalidReason = invalidCheckoutSellerReason(seller);
          if (invalidReason) {
            invalidCartSellers.set(seller?.id ?? item.listing.sellerId, {
              reason: invalidReason,
              sellerUserId: seller?.userId ?? "",
            });
          }
        }
        const cartInvalidReason = [
          invalidBuyerReason,
          ...[...invalidCartSellers.values()].map((value) => value.reason),
        ].filter(Boolean).join(" ");
        const cartInvalidSellerUserIds = [...invalidCartSellers.values()]
          .map((value) => value.sellerUserId)
          .filter(Boolean);

        const maxProcessingDaysCart = Math.max(
          3,
          ...cart.items.map((it) =>
            it.listing.listingType === "IN_STOCK"
              ? (it.listing.shipsWithinDays ?? 1)
              : (it.listing.processingTimeMaxDays ?? 0)
          )
        );
        const { processingDeadline: cartProcessingDeadline, estimatedDeliveryDate: cartEstDelivery } =
          calcDeliveryDates(maxProcessingDaysCart, estDays);

        const createdCartOrder = await prisma.$transaction(async (tx) => {
          await lockCheckoutSessionMutation(tx, sessionId);

          const existingOrder = await tx.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: { id: true },
          });
          if (existingOrder) return null;

          const order = await tx.order.create({
            data: {
              buyerId: orderBuyerId,
              paidAt: new Date(),
              stripeSessionId: sessionId,

              currency,
              itemsSubtotalCents,
              shippingTitle,
              shippingAmountCents,
              taxAmountCents,

              buyerEmail,
              buyerName,
              shipToLine1,
              shipToLine2,
              shipToCity,
              shipToState,
              shipToPostalCode,
              shipToCountry,

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

              quotedToName: sessionMeta.quotedToName ?? null,
              quotedToPhone: sessionMeta.quotedToPhone ?? null,
              quotedToCity: quotedShipToCity || null,
              quotedToState: quotedShipToState || null,
              quotedToPostalCode: quotedShipToPostalCode || null,
              quotedToCountry: quotedShipToCountry || null,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded: reviewNeeded || !!cartInvalidReason,
              reviewNote: cartInvalidReason
                ? cartInvalidReason
                : reviewNeeded
                  ? "Address and/or quoted amount changed at Checkout."
                  : null,

              shippoShipmentId,
              shippoRateObjectId,

              processingDeadline: cartProcessingDeadline,
              estimatedDeliveryDate: cartEstDelivery,

              giftNote,
              giftWrapping,
              giftWrappingPriceCents,
            },
          });

          for (const it of cart.items) {
            // Use Stripe's immutable line_items as authoritative source for
            // quantity and price. Falls back to cart data only if the listing
            // wasn't found in Stripe's line items (e.g. gift wrapping line item
            // doesn't have a listingId).
            const listingVariantKey = `${it.listingId}:${it.variantKey ?? ""}`;
            const paid =
              paidByCartItemId.get(it.id) ??
              paidByListingVariant.get(listingVariantKey)?.shift() ??
              paidByListing.get(it.listingId)?.shift();
            const orderQuantity = paid?.quantity ?? it.quantity;
            const orderPriceCents = paid?.priceCents ?? it.priceCents;
            const priceDrift = checkoutPriceDriftState({
              stripeUnitAmountCents: paid?.priceCents ?? null,
              expectedUnitAmountCents: it.priceCents,
              checkoutPriceVersion: it.priceVersion,
              currentPriceVersion: it.listing.priceVersion,
            });
            if (priceDrift) {
              Sentry.captureMessage("Stripe checkout line price drift detected", {
                level: "warning",
                tags: { source: "stripe_webhook_price_drift", checkoutMode: "cart" },
                extra: {
                  stripeSessionId: sessionId,
                  cartId,
                  cartItemId: it.id,
                  listingId: it.listingId,
                  ...priceDrift,
                },
              });
            }

            // Resolve variant selections from cart item option IDs
            const variantSnapshot: { groupName: string; optionLabel: string; priceAdjustCents: number }[] = [];
            if (it.selectedVariantOptionIds?.length) {
              for (const optId of it.selectedVariantOptionIds) {
                for (const g of (it.listing.variantGroups ?? [])) {
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
                listingId: it.listingId,
                quantity: orderQuantity,
                priceCents: orderPriceCents,
                listingSnapshot: {
                  title: it.listing.title,
                  description: it.listing.description ?? "",
                  priceCents: it.listing.priceCents,
                  imageUrls: it.listing.photos?.map((p: { url: string }) => p.url) ?? [],
                  category: it.listing.category ?? null,
                  tags: it.listing.tags ?? [],
                  sellerName: it.listing.seller?.displayName ?? "",
                  capturedAt: new Date().toISOString(),
                },
                selectedVariants: variantSnapshot.length > 0 ? variantSnapshot : undefined,
              },
            });

            // Stock was already decremented at checkout time (reservation).
            // Just check if we need to mark SOLD_OUT.
            if (it.listing.listingType === "IN_STOCK") {
              await tx.$executeRaw`
                UPDATE "Listing"
                SET status = 'SOLD_OUT'
                WHERE id = ${it.listingId}
                  AND "stockQuantity" <= 0
                  AND status = 'ACTIVE'
              `;
            }
          }

          await tx.cartItem.deleteMany({
            where: sellerIdFromMeta
              ? { cartId, listing: { sellerId: sellerIdFromMeta } }
              : { cartId },
          });

          return order;
        });

        await releaseCheckoutLock(checkoutLockKey, sessionId);

        if (!createdCartOrder) return NextResponse.json({ ok: true });

        if (cartInvalidReason) {
          await refundBlockedCheckout({
            orderId: createdCartOrder.id,
            reason: cartInvalidReason,
            lineItems: stripeLineItems,
            sellerUserIds: cartInvalidSellerUserIds,
          });
          return NextResponse.json({ ok: true });
        }

        await enqueueOrderPostPaymentSideEffects(createdCartOrder.id);

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
                user: { select: { id: true, banned: true, deletedAt: true } },
              },
            },
          },
        });
        const singleSellerInvalidReason = invalidCheckoutSellerReason(listingData?.seller);
        const singleInvalidReason = [invalidBuyerReason, singleSellerInvalidReason].filter(Boolean).join(" ");
        const singleInvalidSellerUserIds =
          singleSellerInvalidReason && listingData?.seller?.userId ? [listingData.seller.userId] : [];
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
        const singleLineItems: CheckoutLineItem[] =
          (s as { line_items?: { data?: CheckoutLineItem[] } }).line_items?.data ?? [];
        const singlePaidLine = singleLineItems.find((lineItem) => {
          const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
          return product?.metadata?.listingId === listingId;
        });
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

          const order = await tx.order.create({
            data: {
              buyerId: orderBuyerId,
              paidAt: new Date(),
              stripeSessionId: sessionId,

              currency,
              itemsSubtotalCents,
              shippingTitle,
              shippingAmountCents,
              taxAmountCents,

              buyerEmail,
              buyerName,
              shipToLine1,
              shipToLine2,
              shipToCity,
              shipToState,
              shipToPostalCode,
              shipToCountry,

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
                  priceCents: price,
                  listingSnapshot: {
                    title: listingData?.title ?? "",
                    description: listingData?.description ?? "",
                    priceCents: listingData?.priceCents ?? price,
                    imageUrls: listingData?.photos?.map((p: { url: string }) => p.url) ?? [],
                    category: listingData?.category ?? null,
                    tags: listingData?.tags ?? [],
                    sellerName: listingData?.seller?.displayName ?? "",
                    capturedAt: new Date().toISOString(),
                  },
                  selectedVariants,
                }],
              },

              shippingCarrier,
              shippingService,
              shippingEta,

              quotedToName: sessionMeta.quotedToName ?? null,
              quotedToPhone: sessionMeta.quotedToPhone ?? null,
              quotedToCity: quotedShipToCity || null,
              quotedToState: quotedShipToState || null,
              quotedToPostalCode: quotedShipToPostalCode || null,
              quotedToCountry: quotedShipToCountry || null,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded: reviewNeeded || !!singleInvalidReason,
              reviewNote: singleInvalidReason
                ? singleInvalidReason
                : reviewNeeded
                  ? "Address and/or quoted amount changed at Checkout."
                  : null,

              shippoShipmentId,
              shippoRateObjectId,

              processingDeadline: singleProcessingDeadline,
              estimatedDeliveryDate: singleEstDelivery,

              giftNote,
              giftWrapping,
              giftWrappingPriceCents,
            },
          });

          // Stock was already decremented at checkout time (reservation).
          // Just check if we need to mark SOLD_OUT.
          if (isInStock) {
            await tx.$executeRaw`
              UPDATE "Listing"
              SET status = 'SOLD_OUT'
              WHERE id = ${listingId}
                AND "stockQuantity" <= 0
                AND status = 'ACTIVE'
            `;
          }

          return order;
        });

        await releaseCheckoutLock(checkoutLockKey, sessionId);

        if (!createdSingleOrder) return NextResponse.json({ ok: true });

        if (singleInvalidReason) {
          await refundBlockedCheckout({
            orderId: createdSingleOrder.id,
            reason: singleInvalidReason,
            lineItems: singleLineItems,
            sellerUserIds: singleInvalidSellerUserIds,
          });
          return NextResponse.json({ ok: true });
        }

        await enqueueOrderPostPaymentSideEffects(createdSingleOrder.id);

        return NextResponse.json({ ok: true });
      }

      Sentry.captureMessage("Stripe checkout completion missing routing metadata", {
        level: "warning",
        tags: { source: "stripe_webhook_checkout_metadata" },
        extra: {
          stripeSessionId: sessionId,
          hasBuyerId: Boolean(buyerId),
          cartId: cartId ?? null,
          sellerId: sellerIdFromMeta ?? null,
          listingId: listingId ?? null,
        },
      });
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
          const seller = await prisma.sellerProfile.findFirst({
            where: { stripeAccountId: account.id },
            select: {
              id: true,
              chargesEnabled: true,
              user: { select: { id: true } },
            },
          });

          if (seller) {
            // Stripe separates the ability to accept charges from payout and
            // verification state. Only mirror charges_enabled into Grainline's
            // buyer-facing purchase gate; payout/requirements problems are
            // operational issues that should be surfaced separately.
            const newChargesEnabled = Boolean(account.charges_enabled);
            if (seller.chargesEnabled !== newChargesEnabled) {
              await prisma.sellerProfile.update({
                where: { id: seller.id },
                data: { chargesEnabled: newChargesEnabled },
              });

              if (!newChargesEnabled) {
                const { logSecurityEvent } = await import("@/lib/security");
                logSecurityEvent("ownership_violation", {
                  userId: seller.user.id,
                  route: "/api/stripe/webhook",
                  reason: `Seller Stripe account disabled by Stripe: ${account.id}`,
                });
              }
            }
          }
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
              select: { id: true, currency: true, sellerRefundId: true, sellerRefundAmountCents: true },
            });
            if (existingOrder) {
              const refundLedger = chargeRefundLedgerState({
                chargeId: charge.id!,
                chargeCurrency: charge.currency,
                amountRefundedCents: charge.amount_refunded,
                latestRefund,
                fallbackRefundId: `external:${event.id}`,
                order: existingOrder,
              });

              await recordOrderPaymentEvent({
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

              if (refundLedger.orderUpdate) {
                await tx.order.update({
                  where: { id: existingOrder.id },
                  data: refundLedger.orderUpdate,
                });
              }
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
            if (!order) return null;
            const sellerUserId = order.items[0]?.listing.seller.userId;
            const disputeLedger = chargeDisputeLedgerState({
              chargeId,
              eventType: event.type,
              dispute,
              orderCurrency: order.currency,
            });
            await recordOrderPaymentEvent({
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
            await tx.order.update({
              where: { id: order.id },
              data: disputeLedger.orderUpdate,
            });
            if (event.type === "charge.dispute.created" && order.buyerId && sellerUserId) {
              const caseAction = disputeCaseAction({
                eventType: event.type,
                existingCase: order.case,
                dispute,
              });
              if (caseAction.action === "update") {
                await tx.case.update({
                  where: { id: caseAction.caseId },
                  data: { status: caseAction.status },
                });
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
            return event.type === "charge.dispute.created" && sellerUserId
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
            select: { id: true },
          });
          const affectedSellerIds = affectedSellers.map((seller) => seller.id);
          await prisma.sellerProfile.updateMany({
            where: { stripeAccountId: deauthAccount.id },
            data: {
              chargesEnabled: false,
              stripeAccountId: null,
            },
          });
          if (affectedSellerIds.length > 0) {
            await prisma.order.updateMany({
              where: {
                reviewNeeded: false,
                fulfillmentStatus: { in: ["PENDING", "READY_FOR_PICKUP", "SHIPPED"] },
                items: { some: { listing: { sellerId: { in: affectedSellerIds } } } },
              },
              data: {
                reviewNeeded: true,
                reviewNote: "Seller Stripe account was deauthorized after payment. Staff must review payout and fulfillment state before further action.",
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
      return NextResponse.json({ ok: true });
    }
    console.error("Stripe webhook handler error:", err);
    Sentry.captureException(err, { tags: { source: "stripe_webhook" } });
    await recordWebhookFailureSpike({
      webhook: "stripe",
      kind: "handler",
      status: 500,
      extra: { stripeEventId: event.id, stripeEventType: event.type },
    });
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
