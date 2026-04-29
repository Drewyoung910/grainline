// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import {
  sendOrderConfirmedBuyer,
  sendOrderConfirmedSeller,
  sendFirstSaleCongrats,
} from "@/lib/email";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { checkoutCompletionNeedsReview } from "@/lib/checkoutCompletionState";
import {
  beginStripeWebhookEvent,
  markStripeWebhookEventFailed,
  markStripeWebhookEventProcessed,
} from "@/lib/stripeWebhookEvents";
import {
  chargeRefundLedgerState,
  invalidCheckoutSellerReason,
  latestSuccessfulRefund,
  normalizeShippoRateObjectId,
  parseOptionalNonNegativeInt,
  parsePositiveInt,
} from "@/lib/stripeWebhookState";
import type { FulfillmentStatus, Prisma } from "@prisma/client";


export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: unknown) {
    console.error("Stripe webhook signature verification failed:", (err as { message?: string })?.message);
    Sentry.captureException(err, { tags: { source: "stripe_webhook_signature" } });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Handle Stripe Workbench Snapshot thin events:
  // thin events only carry { id, object } (≤3 keys) in data.object — retrieve full payload if needed
  const rawDataObj = event.data.object as unknown as Record<string, unknown>;
  if (typeof rawDataObj.id === "string" && Object.keys(rawDataObj).length <= 3) {
    try {
      event = await stripe.events.retrieve(event.id);
    } catch (retrieveErr) {
      console.error("Webhook: failed to retrieve full event:", retrieveErr);
      return NextResponse.json({ error: "Failed to retrieve event" }, { status: 500 });
    }
  }

  async function processIdempotentEvent(
    handler: () => Promise<NextResponse>,
  ): Promise<NextResponse> {
    const shouldProcess = await beginStripeWebhookEvent(event.id, event.type);
    if (!shouldProcess) return NextResponse.json({ ok: true });
    try {
      const response = await handler();
      await markStripeWebhookEventProcessed(event.id);
      return response;
    } catch (handlerErr) {
      try {
        await markStripeWebhookEventFailed(event.id, handlerErr);
      } catch (markErr) {
        Sentry.captureException(markErr, {
          tags: { source: "stripe_webhook_mark_failed" },
          extra: { stripeEventId: event.id, stripeEventType: event.type },
        });
      }
      throw handlerErr;
    }
  }

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
  }) {
    await prisma.orderPaymentEvent.upsert({
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

  async function lockCheckoutSessionMutation(tx: Prisma.TransactionClient, sessionId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(913337, hashtext(${sessionId}))`;
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      return processIdempotentEvent(async () => {
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

      // Idempotency
      const already = await prisma.order.findFirst({
        where: { stripeSessionId: sessionId },
        select: { id: true },
      });
      if (already) return NextResponse.json({ ok: true });

      // Retrieve with expansions (line_items needed to derive quantities at payment time)
      const s = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.charges.data", "shipping_cost.shipping_rate", "line_items.data.price.product"],
      });

      // Only process paid sessions — skip async/pending payments
      if (s.payment_status !== "paid") return NextResponse.json({ ok: true });

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

      const sessionMeta = (s.metadata ?? {}) as Record<string, string | undefined>;
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

      type CheckoutLineItem = {
        quantity?: number | null;
        price?: {
          unit_amount?: number | null;
          product?: { metadata?: Record<string, string> } | string | null;
        } | null;
      };

      async function restoreReservedStockFromLineItems(lineItems: CheckoutLineItem[]) {
        const restoreByListingId = new Map<string, number>();
        for (const lineItem of lineItems) {
          const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
          const listingId = product?.metadata?.listingId;
          const quantity = lineItem.quantity ?? 0;
          if (!listingId || quantity <= 0) continue;
          restoreByListingId.set(listingId, (restoreByListingId.get(listingId) ?? 0) + quantity);
        }
        if (restoreByListingId.size === 0) return;

        await prisma.$transaction(async (tx) => {
          for (const [listingId, quantity] of restoreByListingId.entries()) {
            await tx.$executeRaw`
              UPDATE "Listing"
              SET "stockQuantity" = "stockQuantity" + ${quantity}
              WHERE id = ${listingId}
                AND "listingType" = 'IN_STOCK'
            `;
            await tx.listing.updateMany({
              where: { id: listingId, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
              data: { status: "ACTIVE" },
            });
          }
        });
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
          const refund = await stripe.refunds.create(
            {
              payment_intent: paymentIntentId,
              refund_application_fee: true,
              reverse_transfer: true,
            },
            { idempotencyKey: `blocked-checkout-refund:${sessionId}` },
          );

          await restoreReservedStockFromLineItems(input.lineItems);

          await prisma.order.update({
            where: { id: input.orderId },
            data: {
              sellerRefundId: refund.id,
              sellerRefundAmountCents: refund.amount ?? s.amount_total ?? null,
              sellerRefundLockedAt: null,
              reviewNeeded: true,
              reviewNote: `${reviewPrefix} Automatic refund issued because the maker account was not eligible to accept this order.`,
            },
          });

          if (buyerId) {
            await createNotification({
              userId: buyerId,
              type: "NEW_ORDER",
              title: "Payment refunded",
              body: "This payment was refunded because the maker is not currently available to accept orders.",
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
          await releaseCheckoutLock(sessionMeta.checkoutLockKey, sessionId);
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
        const cartInvalidReason = [...invalidCartSellers.values()].map((value) => value.reason).join(" ");
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
              buyerId,
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

              reviewNeeded: reviewNeeded || invalidCartSellers.size > 0,
              reviewNote: invalidCartSellers.size > 0
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

        await releaseCheckoutLock(sessionMeta.checkoutLockKey, sessionId);

        if (!createdCartOrder) return NextResponse.json({ ok: true });

        if (invalidCartSellers.size > 0) {
          await refundBlockedCheckout({
            orderId: createdCartOrder.id,
            reason: cartInvalidReason,
            lineItems: stripeLineItems,
            sellerUserIds: cartInvalidSellerUserIds,
          });
          return NextResponse.json({ ok: true });
        }

        // Notify buyer + seller after cart checkout
        try {
          const createdOrder = await prisma.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: {
              id: true,
              buyerId: true,
              itemsSubtotalCents: true,
              shippingAmountCents: true,
              taxAmountCents: true,
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
                  listing: {
                    select: {
                      title: true,
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
          if (createdOrder) {
            const seller = createdOrder.items[0]?.listing.seller;
            const sellerUserId = seller?.userId;
            const sellerName = seller?.displayName ?? "Maker";
            const firstItemTitle = createdOrder.items[0]?.listing.title ?? "an item";
            const buyerDisplayName = createdOrder.buyer?.name ?? buyerEmail ?? "A buyer";

            await Promise.all([
              createdOrder.buyerId
                ? createNotification({
                    userId: createdOrder.buyerId,
                    type: "NEW_ORDER",
                    title: "Order confirmed!",
                    body: `Your order from ${sellerName} is being prepared`,
                    link: `/dashboard/orders/${createdOrder.id}`,
                  })
                : Promise.resolve(),
              sellerUserId
                ? createNotification({
                    userId: sellerUserId,
                    type: "NEW_ORDER",
                    title: "New sale! Congrats!",
                    body: `${buyerDisplayName} purchased ${firstItemTitle}`,
                    link: `/dashboard/sales/${createdOrder.id}`,
                  })
                : Promise.resolve(),
            ]);

            // Low-stock alerts for IN_STOCK items that dipped to ≤ 2.
            // Re-read current stock from DB in one batch (post-decrement).
            if (sellerUserId) {
              const inStockItemTitles = new Map<string, string>();
              for (const it of cart.items) {
                if (it.listing.listingType === "IN_STOCK") {
                  inStockItemTitles.set(it.listingId, it.listing.title);
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

            const emailItems = createdOrder.items.map((it) => ({
              title: it.listing.title,
              quantity: it.quantity,
              priceCents: it.priceCents,
            }));
            const orderSummary = {
              id: createdOrder.id,
              itemsSubtotalCents: createdOrder.itemsSubtotalCents,
              shippingAmountCents: createdOrder.shippingAmountCents,
              taxAmountCents: createdOrder.taxAmountCents,
              estimatedDeliveryDate: createdOrder.estimatedDeliveryDate,
              processingDeadline: createdOrder.processingDeadline,
              shipToLine1: createdOrder.shipToLine1,
              shipToCity: createdOrder.shipToCity,
              shipToState: createdOrder.shipToState,
              shipToPostalCode: createdOrder.shipToPostalCode,
            };

            if (createdOrder.buyer?.email) {
              try {
                await sendOrderConfirmedBuyer({
                  order: orderSummary,
                  buyer: { name: createdOrder.buyer.name, email: createdOrder.buyer.email },
                  seller: { displayName: sellerName },
                  items: emailItems,
                });
              } catch { /* non-fatal */ }
            }

            if (sellerUserId && seller?.user?.email) {
              try {
                const sellerOrderCount = await prisma.order.count({
                  where: { items: { some: { listing: { seller: { userId: sellerUserId } } } } },
                });
                if (await shouldSendEmail(sellerUserId, "EMAIL_NEW_ORDER")) {
                  await sendOrderConfirmedSeller({
                    order: orderSummary,
                    buyer: { name: buyerDisplayName },
                    seller: { displayName: sellerName, email: seller.user.email },
                    items: emailItems,
                  });
                }
                if (sellerOrderCount === 1) {
                  await sendFirstSaleCongrats({
                    seller: { displayName: sellerName, email: seller.user.email },
                    order: orderSummary,
                  });
                }
              } catch { /* non-fatal */ }
            }
          }
        } catch {
          // never break webhook flow
        }

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
        const singleInvalidReason = invalidCheckoutSellerReason(listingData?.seller);
        const singleInvalidSellerUserIds =
          singleInvalidReason && listingData?.seller?.userId ? [listingData.seller.userId] : [];
        const price = priceCentsFromMeta ?? listingData?.priceCents ?? 0;
        const isInStock = listingData?.listingType === "IN_STOCK";
        const effectiveProcessingDays = isInStock
          ? (listingData?.shipsWithinDays ?? 1)
          : (listingData?.processingTimeMaxDays ?? 0);
        const maxProcessingDaysSingle = Math.max(isInStock ? 1 : 3, effectiveProcessingDays);
        const { processingDeadline: singleProcessingDeadline, estimatedDeliveryDate: singleEstDelivery } =
          calcDeliveryDates(maxProcessingDaysSingle, estDays);

        const createdSingleOrder = await prisma.$transaction(async (tx) => {
          await lockCheckoutSessionMutation(tx, sessionId);

          const existingOrder = await tx.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: { id: true },
          });
          if (existingOrder) return null;

          const order = await tx.order.create({
            data: {
              buyerId,
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
                  selectedVariants: (() => {
                    try {
                      const sv = sessionMeta.selectedVariants;
                      if (typeof sv === "string" && sv.length > 2) return JSON.parse(sv);
                    } catch { /* skip */ }
                    return undefined;
                  })(),
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

        await releaseCheckoutLock(sessionMeta.checkoutLockKey, sessionId);

        if (!createdSingleOrder) return NextResponse.json({ ok: true });

        if (singleInvalidReason) {
          const singleLineItems: CheckoutLineItem[] =
            (s as { line_items?: { data?: CheckoutLineItem[] } }).line_items?.data ?? [];
          await refundBlockedCheckout({
            orderId: createdSingleOrder.id,
            reason: singleInvalidReason,
            lineItems: singleLineItems,
            sellerUserIds: singleInvalidSellerUserIds,
          });
          return NextResponse.json({ ok: true });
        }

        // Notify buyer + seller after single-listing checkout
        try {
          const singleOrder = await prisma.order.findFirst({
            where: { stripeSessionId: sessionId },
            select: {
              id: true,
              buyerId: true,
              itemsSubtotalCents: true,
              shippingAmountCents: true,
              taxAmountCents: true,
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
                  listing: {
                    select: {
                      title: true,
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
          if (singleOrder) {
            const seller = singleOrder.items[0]?.listing.seller;
            const sellerUserId = seller?.userId;
            const sellerName = seller?.displayName ?? "Maker";
            const itemTitle = singleOrder.items[0]?.listing.title ?? "an item";
            const buyerDisplayName = singleOrder.buyer?.name ?? buyerEmail ?? "A buyer";

            await Promise.all([
              singleOrder.buyerId
                ? createNotification({
                    userId: singleOrder.buyerId,
                    type: "NEW_ORDER",
                    title: "Order confirmed!",
                    body: `Your order from ${sellerName} is being prepared`,
                    link: `/dashboard/orders/${singleOrder.id}`,
                  })
                : Promise.resolve(),
              sellerUserId
                ? createNotification({
                    userId: sellerUserId,
                    type: "NEW_ORDER",
                    title: "New sale! Congrats!",
                    body: `${buyerDisplayName} purchased ${itemTitle}`,
                    link: `/dashboard/sales/${singleOrder.id}`,
                  })
                : Promise.resolve(),
            ]);

            // Low-stock alert if IN_STOCK item dipped to ≤ 2 after purchase.
            // Re-read current stock from DB (post-decrement) for accurate count.
            if (isInStock && sellerUserId) {
              const currentSingleListing = await prisma.listing.findUnique({
                where: { id: listingId },
                select: { stockQuantity: true },
              });
              const currentSingleQty = currentSingleListing?.stockQuantity ?? 0;
              if (currentSingleQty > 0 && currentSingleQty <= 2) {
                await createNotification({
                  userId: sellerUserId,
                  type: "LOW_STOCK",
                  title: `${itemTitle} is running low`,
                  body: `Only ${currentSingleQty} left in stock`,
                  link: `/dashboard/inventory`,
                });
              }
            }

            const emailItems = singleOrder.items.map((it) => ({
              title: it.listing.title,
              quantity: it.quantity,
              priceCents: it.priceCents,
            }));
            const orderSummary = {
              id: singleOrder.id,
              itemsSubtotalCents: singleOrder.itemsSubtotalCents,
              shippingAmountCents: singleOrder.shippingAmountCents,
              taxAmountCents: singleOrder.taxAmountCents,
              estimatedDeliveryDate: singleOrder.estimatedDeliveryDate,
              processingDeadline: singleOrder.processingDeadline,
              shipToLine1: singleOrder.shipToLine1,
              shipToCity: singleOrder.shipToCity,
              shipToState: singleOrder.shipToState,
              shipToPostalCode: singleOrder.shipToPostalCode,
            };

            if (singleOrder.buyer?.email) {
              try {
                await sendOrderConfirmedBuyer({
                  order: orderSummary,
                  buyer: { name: singleOrder.buyer.name, email: singleOrder.buyer.email },
                  seller: { displayName: sellerName },
                  items: emailItems,
                });
              } catch { /* non-fatal */ }
            }

            if (sellerUserId && seller?.user?.email) {
              try {
                const sellerOrderCount = await prisma.order.count({
                  where: { items: { some: { listing: { seller: { userId: sellerUserId } } } } },
                });
                if (await shouldSendEmail(sellerUserId, "EMAIL_NEW_ORDER")) {
                  await sendOrderConfirmedSeller({
                    order: orderSummary,
                    buyer: { name: buyerDisplayName },
                    seller: { displayName: sellerName, email: seller.user.email },
                    items: emailItems,
                  });
                }
                if (sellerOrderCount === 1) {
                  await sendFirstSaleCongrats({
                    seller: { displayName: sellerName, email: seller.user.email },
                    order: orderSummary,
                  });
                }
              } catch { /* non-fatal */ }
            }
          }
        } catch {
          // never break webhook flow
        }

        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
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
          const latestRefund = latestSuccessfulRefund(charge.refunds?.data ?? []);
          const existingOrder = await prisma.order.findFirst({
            where: { stripeChargeId: charge.id },
            select: { id: true, currency: true, sellerRefundId: true, sellerRefundAmountCents: true },
          });
          if (existingOrder) {
            const refundLedger = chargeRefundLedgerState({
              chargeId: charge.id,
              chargeCurrency: charge.currency,
              amountRefundedCents: charge.amount_refunded,
              latestRefund,
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
            });

            if (refundLedger.orderUpdate) {
              await prisma.order.update({
                where: { id: existingOrder.id },
                data: refundLedger.orderUpdate,
              });
            }
          }
        }
        return NextResponse.json({ received: true });
      });
    }

    if (event.type.startsWith("charge.dispute.")) {
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
          const order = await prisma.order.findFirst({
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
          if (order) {
            const sellerUserId = order.items[0]?.listing.seller.userId;
            await recordOrderPaymentEvent({
              orderId: order.id,
              stripeEventId: event.id,
              stripeObjectId: dispute.id ?? null,
              stripeObjectType: "dispute",
              eventType: "DISPUTE",
              amountCents: dispute.amount ?? null,
              currency: dispute.currency ?? order.currency,
              status: dispute.status ?? event.type.replace("charge.dispute.", ""),
              reason: dispute.reason ?? null,
              description: `Stripe dispute ${event.type}${dispute.reason ? `: ${dispute.reason}` : ""}`,
              metadata: {
                chargeId,
                disputeId: dispute.id ?? null,
                stripeEventType: event.type,
              },
            });
            await prisma.order.update({
              where: { id: order.id },
              data: {
                reviewNeeded: true,
                reviewNote: `Stripe dispute ${event.type}${dispute.reason ? `: ${dispute.reason}` : ""}`,
              },
            });
            if (event.type === "charge.dispute.created" && order.buyerId && sellerUserId) {
              if (order.case) {
                if (order.case.status !== "RESOLVED" && order.case.status !== "CLOSED") {
                  await prisma.case.update({
                    where: { id: order.case.id },
                    data: { status: "UNDER_REVIEW" },
                  });
                }
              } else {
                await prisma.case.create({
                  data: {
                    orderId: order.id,
                    buyerId: order.buyerId,
                    sellerId: sellerUserId,
                    reason: "OTHER",
                    description: `Stripe payment dispute ${dispute.id ?? ""}${dispute.reason ? `: ${dispute.reason}` : ""}`.trim(),
                    status: "UNDER_REVIEW",
                    sellerRespondBy: new Date(Date.now() + 48 * 60 * 60 * 1000),
                  },
                });
              }
            }
            if (event.type === "charge.dispute.created" && sellerUserId) {
              await createNotification({
                userId: sellerUserId,
                type: "PAYMENT_DISPUTE",
                title: "Payment dispute opened",
                body: `Stripe reported a dispute for order ${order.id}.`,
                link: `/dashboard/sales/${order.id}`,
              });
            }
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
            await prisma.sellerPayoutEvent.upsert({
              where: { stripePayoutId: payout.id },
              create: {
                sellerProfileId: seller.id,
                stripePayoutId: payout.id,
                status: payout.status ?? "failed",
                amountCents: payout.amount ?? null,
                currency: payout.currency ?? "usd",
                failureCode: payout.failure_code ?? null,
                failureMessage: payout.failure_message ?? null,
                stripeEventId: event.id,
              },
              update: {
                status: payout.status ?? "failed",
                amountCents: payout.amount ?? null,
                currency: payout.currency ?? "usd",
                failureCode: payout.failure_code ?? null,
                failureMessage: payout.failure_message ?? null,
                stripeEventId: event.id,
              },
            });
            await createNotification({
              userId: seller.userId,
              type: "PAYOUT_FAILED",
              title: "Payout failed",
              body: payout.failure_message
                ? `Stripe could not complete a payout: ${payout.failure_message}`
                : "Stripe could not complete a payout. Review your Stripe account so the payout can be retried.",
              link: "/dashboard/seller",
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
          await prisma.sellerProfile.updateMany({
            where: { stripeAccountId: deauthAccount.id },
            data: {
              chargesEnabled: false,
              stripeAccountId: null,
            },
          });
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
      type ExpiredLineItem = { quantity?: number | null; price?: { product?: { metadata?: Record<string, string> } | string | null } | null };
      let expiredLineItems: ExpiredLineItem[] = [];

      // Retrieve Stripe line items before the DB transaction. The transaction
      // re-checks order existence after taking the advisory lock.
      if (expiredCartId && expiredSellerId) {
        const expiredS = await stripe.checkout.sessions.retrieve(expiredSession.id, {
          expand: ["line_items.data.price.product"],
        });
        expiredLineItems = (expiredS as { line_items?: { data?: ExpiredLineItem[] } }).line_items?.data ?? [];
      }

      await prisma.$transaction(async (tx) => {
        await lockCheckoutSessionMutation(tx, expiredSession.id);

        // Check this session didn't already create an order (edge case: completed + expired both fire)
        const orderExists = await tx.order.findFirst({
          where: { stripeSessionId: expiredSession.id },
          select: { id: true },
        });
        if (orderExists) return; // paid — don't restore

        // Single-item checkout: restore the listing's stock
        const expiredListingId = expiredMeta.listingId;
        const expiredQuantity = parsePositiveInt(expiredMeta.quantity, 1);
        if (expiredListingId) {
          await tx.$executeRaw`
            UPDATE "Listing"
            SET "stockQuantity" = "stockQuantity" + ${expiredQuantity}
            WHERE id = ${expiredListingId}
              AND "listingType" = 'IN_STOCK'
          `;
          // If stock was 0 (SOLD_OUT from reservation), restore to ACTIVE
          await tx.listing.updateMany({
            where: { id: expiredListingId, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
            data: { status: "ACTIVE" },
          });
        }

        // Cart checkout: restore stock for all items from this seller
        if (expiredCartId && expiredSellerId) {
          for (const li of expiredLineItems) {
            const prod = typeof li.price?.product === "object" ? li.price?.product : null;
            const lid = prod?.metadata?.listingId;
            if (lid && li.quantity) {
              await tx.$executeRaw`
                UPDATE "Listing"
                SET "stockQuantity" = "stockQuantity" + ${li.quantity}
                WHERE id = ${lid}
                  AND "listingType" = 'IN_STOCK'
              `;
              await tx.listing.updateMany({
                where: { id: lid, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
                data: { status: "ACTIVE" },
              });
            }
          }
        }
      });

      await releaseCheckoutLock(expiredMeta.checkoutLockKey, expiredSession.id);

      return NextResponse.json({ ok: true });
      });
    }

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
    return NextResponse.json({ error: "Webhook error" }, { status: 500 });
  }
}
