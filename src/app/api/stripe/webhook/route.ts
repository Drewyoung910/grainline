// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import {
  sendOrderConfirmedBuyer,
  sendOrderConfirmedSeller,
  sendFirstSaleCongrats,
} from "@/lib/email";
import type { FulfillmentStatus } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: unknown) {
    console.error("Stripe webhook signature verification failed:", (err as { message?: string })?.message);
    return new NextResponse("Invalid signature", { status: 400 });
  }

  console.log("Webhook received:", event.type, event.id);

  // Handle Stripe Workbench Snapshot thin events:
  // thin events only carry { id, object } (≤3 keys) in data.object — retrieve full payload if needed
  const rawDataObj = event.data.object as unknown as Record<string, unknown>;
  if (typeof rawDataObj.id === "string" && Object.keys(rawDataObj).length <= 3) {
    try {
      event = await stripe.events.retrieve(event.id);
      console.log("Webhook: retrieved full event for thin payload", event.id);
    } catch (retrieveErr) {
      console.error("Webhook: failed to retrieve full event:", retrieveErr);
      return new NextResponse("Failed to retrieve event", { status: 500 });
    }
  }

  try {
    if (event.type === "checkout.session.completed") {
      type StripeSession = {
        id: string;
        currency?: string | null;
        amount_subtotal?: number | null;
        shipping_cost?: { amount_total?: number | null; shipping_rate?: unknown } | null;
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

      // Retrieve with expansions
      const s = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent.charges.data", "shipping_cost.shipping_rate"],
      });

      // Stripe snapshots
      const currency: string = (s.currency || "usd").toLowerCase();
      const itemsSubtotalCents: number = s.amount_subtotal ?? 0;
      const shippingAmountCents: number = s.shipping_cost?.amount_total ?? 0;
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
      const buyerName: string | undefined = s.customer_details?.name || undefined;

      const addr = (s as unknown as { shipping_details?: { address?: Record<string, string | null> | null } }).shipping_details?.address ?? s.customer_details?.address ?? null;
      const shipToLine1 = addr?.line1 ?? null;
      const shipToLine2 = addr?.line2 ?? null;
      const shipToCity = addr?.city ?? null;
      const shipToState = addr?.state ?? null;
      const shipToPostalCode = addr?.postal_code ?? null;
      const shipToCountry = addr?.country ?? null;

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

      const buyerId: string | undefined = s?.metadata?.buyerId;

      // Quoted snapshot from metadata (typed on-site)
      const quotedShipToPostalCode = s?.metadata?.quotedShipToPostalCode || "";
      const quotedShipToState = s?.metadata?.quotedShipToState || "";
      const quotedShipToCity = s?.metadata?.quotedShipToCity || "";
      const quotedShipToCountry = s?.metadata?.quotedShipToCountry || "";
      const quotedShippingAmountCents =
        s?.metadata?.quotedShippingAmountCents != null &&
        s.metadata.quotedShippingAmountCents !== ""
          ? Number(s.metadata.quotedShippingAmountCents)
          : null;
      const useCalculated = String(s?.metadata?.useCalculated || "false") === "true";

      // Gift options from metadata
      const giftNote: string | null = s?.metadata?.giftNote || null;
      const giftWrapping: boolean = s?.metadata?.giftWrapping === "true";
      const giftWrappingPriceCentsRaw = s?.metadata?.giftWrappingPriceCents ? parseInt(s.metadata.giftWrappingPriceCents, 10) : null;
      const giftWrappingPriceCents: number | null = giftWrappingPriceCentsRaw != null && Number.isFinite(giftWrappingPriceCentsRaw) ? giftWrappingPriceCentsRaw : null;

      // Shippo IDs from metadata / selected shipping rate
      const shippoShipmentId: string | null = s?.metadata?.shippoShipmentId || null;
      const shippoRateObjectId: string | null = shippingRateObj?.metadata?.objectId || null;

      // estDays stored in shipping rate metadata at checkout time; default 7 if missing
      const rawEstDays = shippingRateObj?.metadata?.estDays;
      const estDays: number =
        rawEstDays != null && rawEstDays !== "" && !isNaN(Number(rawEstDays))
          ? Number(rawEstDays)
          : 7;

      // Mismatch checks
      const normalizeZip = (z: string) => z.split("-")[0];
      const normalizeState = (s: string) => s.toUpperCase();
      const normalizeCity = (c: string) => c.trim().toLowerCase();

      const addressMismatch =
        (quotedShipToPostalCode && normalizeZip(quotedShipToPostalCode) !== normalizeZip(shipToPostalCode || "")) ||
        (quotedShipToState && normalizeState(quotedShipToState) !== normalizeState(shipToState || "")) ||
        (quotedShipToCity && normalizeCity(quotedShipToCity) !== normalizeCity(shipToCity || "")) ||
        (quotedShipToCountry && quotedShipToCountry !== (shipToCountry || ""));

      const amountMismatch =
        useCalculated &&
        quotedShippingAmountCents != null &&
        shippingAmountCents != null &&
        quotedShippingAmountCents !== shippingAmountCents;

      const reviewNeeded = !!(addressMismatch || amountMismatch);

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

      // Tax reversal helper — reverse tax portion of seller transfer for marketplace facilitator compliance
      async function reverseTaxIfNeeded(orderId: string) {
        console.log("reverseTaxIfNeeded called", { orderId });
        const taxAmount = s.total_details?.amount_tax ?? 0;
        const taxAlreadyRetained = s?.metadata?.taxRetainedAtCreation === "true";

        // Try to resolve transferId — may be null from expansion if transfer was async
        let transferId = stripeTransferId;
        if (!transferId && paymentIntentId) {
          try {
            const piExpanded = await stripe.paymentIntents.retrieve(paymentIntentId, {
              expand: ["latest_charge"],
            });
            const latestCharge = piExpanded.latest_charge as { transfer?: string | { id?: string } } | null;
            transferId = latestCharge
              ? (typeof latestCharge.transfer === "string" ? latestCharge.transfer : latestCharge.transfer?.id ?? null)
              : null;
            console.log("reverseTaxIfNeeded re-fetched transferId", { transferId });
          } catch (e) {
            console.warn("reverseTaxIfNeeded PI re-fetch failed", e);
          }
        }

        console.log("reverseTaxIfNeeded state", { orderId, transferId, taxAmount, taxAlreadyRetained });

        if (taxAmount === 0 && !taxAlreadyRetained) {
          console.warn("Zero tax collected on order", { orderId, sessionId, note: "Verify Stripe Tax nexus if unexpected" });
        }

        if (taxAlreadyRetained) {
          console.log("reverseTaxIfNeeded skipped — tax retained at creation");
          return;
        }

        if (taxAmount > 0 && transferId) {
          console.log("reverseTaxIfNeeded attempting reversal", { transferId, taxAmount });
          try {
            const reversal = await stripe.transfers.createReversal(
              transferId,
              { amount: taxAmount, description: "Tax retention — marketplace facilitator", metadata: { sessionId, orderId, reason: "tax_retention" } },
              { idempotencyKey: `tax-reversal-${sessionId}` }
            );
            console.log("reverseTaxIfNeeded success", { reversalId: reversal.id, taxAmount });
            await prisma.order.update({ where: { id: orderId }, data: { taxReversalId: reversal.id, taxReversalAmountCents: taxAmount } });
          } catch (err) {
            console.error("Tax reversal failed:", err);
            const stripeErr = err as { code?: string; message?: string };
            const isBalanceIssue = stripeErr.code === "insufficient_funds" || stripeErr.message?.toLowerCase().includes("insufficient");
            Sentry.captureException(err, { level: isBalanceIssue ? "fatal" : "error", extra: { orderId, taxAmount, isBalanceIssue } });
            await prisma.order.update({ where: { id: orderId }, data: { reviewNeeded: true } });
          }
        } else {
          console.log("reverseTaxIfNeeded skipped — no tax or no transfer", { taxAmount, transferId });
        }
      }

      // CART CHECKOUT
      const cartId: string | undefined = s?.metadata?.cartId;
      const sellerIdFromMeta: string | undefined = s?.metadata?.sellerId;

      if (cartId && buyerId) {
        const cart = await prisma.cart.findUnique({
          where: { id: cartId },
          include: {
            items: {
              include: { listing: true },
              where: sellerIdFromMeta ? { listing: { sellerId: sellerIdFromMeta } } : undefined,
            },
          },
        });

        if (!cart || cart.items.length === 0) {
          return NextResponse.json({ ok: true });
        }

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

        await prisma.$transaction(async (tx) => {
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

              quotedToCity: quotedShipToCity || null,
              quotedToState: quotedShipToState || null,
              quotedToPostalCode: quotedShipToPostalCode || null,
              quotedToCountry: quotedShipToCountry || null,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded,
              reviewNote: reviewNeeded
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
            await tx.orderItem.create({
              data: {
                orderId: order.id,
                listingId: it.listingId,
                quantity: it.quantity,
                priceCents: it.priceCents,
              },
            });

            if (it.listing.listingType === "IN_STOCK") {
              const newQty = Math.max(0, (it.listing.stockQuantity ?? 0) - it.quantity);
              await tx.listing.update({
                where: { id: it.listingId },
                data: {
                  stockQuantity: newQty,
                  // TODO: When stock is restocked (e.g. via inventory update route), query
                  // StockNotification for this listing and send emails to subscribers via Resend.
                  // Actual email sending deferred until sending domain is verified.
                  ...(newQty <= 0 ? { status: "SOLD_OUT" } : {}),
                },
              });
            }
          }

          await tx.cartItem.deleteMany({
            where: sellerIdFromMeta
              ? { cartId, listing: { sellerId: sellerIdFromMeta } }
              : { cartId },
          });
        });

        // Reverse tax portion of seller transfer (marketplace facilitator)
        const cartOrder = await prisma.order.findFirst({ where: { stripeSessionId: sessionId }, select: { id: true } });
        if (cartOrder) await reverseTaxIfNeeded(cartOrder.id);

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

            console.log('NEW_ORDER notification:', { buyerUserId: createdOrder.buyerId, sellerUserId });
            await Promise.all([
              createNotification({
                userId: createdOrder.buyerId,
                type: "NEW_ORDER",
                title: "Order confirmed!",
                body: `Your order from ${sellerName} is being prepared`,
                link: `/dashboard/orders/${createdOrder.id}`,
              }),
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

            // Low-stock alerts for IN_STOCK items that dipped to ≤ 2
            if (sellerUserId) {
              for (const it of cart.items) {
                if (it.listing.listingType === "IN_STOCK") {
                  const newQty = Math.max(0, (it.listing.stockQuantity ?? 0) - it.quantity);
                  if (newQty > 0 && newQty <= 2) {
                    await createNotification({
                      userId: sellerUserId,
                      type: "LOW_STOCK",
                      title: `${it.listing.title} is running low`,
                      body: `Only ${newQty} left in stock`,
                      link: `/dashboard/inventory`,
                    });
                  }
                }
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
      const listingId: string | undefined = s?.metadata?.listingId;
      const quantity: number = Math.max(1, Number(s?.metadata?.quantity || 1));
      const priceCentsFromMeta: number | null =
        s?.metadata?.priceCents != null ? Number(s.metadata.priceCents) : null;

      if (listingId && buyerId) {
        const listingData = await prisma.listing.findUnique({
          where: { id: listingId },
          select: {
            priceCents: true,
            processingTimeMaxDays: true,
            listingType: true,
            stockQuantity: true,
            shipsWithinDays: true,
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

        await prisma.$transaction(async (tx) => {
          await tx.order.create({
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

              items: { create: [{ listingId, quantity, priceCents: price }] },

              shippingCarrier,
              shippingService,
              shippingEta,

              quotedToCity: quotedShipToCity || null,
              quotedToState: quotedShipToState || null,
              quotedToPostalCode: quotedShipToPostalCode || null,
              quotedToCountry: quotedShipToCountry || null,
              quotedShippingAmountCents: quotedShippingAmountCents ?? null,

              reviewNeeded,
              reviewNote: reviewNeeded
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

          if (isInStock) {
            const newQty = Math.max(0, (listingData?.stockQuantity ?? 0) - quantity);
            await tx.listing.update({
              where: { id: listingId },
              data: {
                stockQuantity: newQty,
                // TODO: When stock is restocked (e.g. via inventory update route), query
                // StockNotification for this listing and send emails to subscribers via Resend.
                // Actual email sending deferred until sending domain is verified.
                ...(newQty <= 0 ? { status: "SOLD_OUT" } : {}),
              },
            });
          }
        });

        // Reverse tax portion of seller transfer (marketplace facilitator)
        const singleOrder = await prisma.order.findFirst({ where: { stripeSessionId: sessionId }, select: { id: true } });
        if (singleOrder) await reverseTaxIfNeeded(singleOrder.id);

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

            console.log('NEW_ORDER notification:', { buyerUserId: singleOrder.buyerId, sellerUserId });
            await Promise.all([
              createNotification({
                userId: singleOrder.buyerId,
                type: "NEW_ORDER",
                title: "Order confirmed!",
                body: `Your order from ${sellerName} is being prepared`,
                link: `/dashboard/orders/${singleOrder.id}`,
              }),
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

            // Low-stock alert if IN_STOCK item dipped to ≤ 2 after purchase
            if (isInStock && sellerUserId) {
              const newQty = Math.max(0, (listingData?.stockQuantity ?? 0) - quantity);
              if (newQty > 0 && newQty <= 2) {
                await createNotification({
                  userId: sellerUserId,
                  type: "LOW_STOCK",
                  title: `${itemTitle} is running low`,
                  body: `Only ${newQty} left in stock`,
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
    }

    if (event.type === "account.updated") {
      const account = event.data.object as { id: string; charges_enabled?: boolean };
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
          const newChargesEnabled = account.charges_enabled ?? false;
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
    }

    if (event.type === "account.application.deauthorized") {
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
    }

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return new NextResponse("Webhook error", { status: 500 });
  }
}






