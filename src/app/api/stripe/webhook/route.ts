// src/app/api/stripe/webhook/route.ts
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/db";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import {
  sendOrderConfirmedBuyer,
  sendOrderConfirmedSeller,
  sendFirstSaleCongrats,
} from "@/lib/email";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import type { FulfillmentStatus } from "@prisma/client";


export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = (await headers()).get("stripe-signature") as string;
  const secret = process.env.STRIPE_WEBHOOK_SECRET!;
  let event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err: unknown) {
    console.error("Stripe webhook signature verification failed:", (err as { message?: string })?.message);
    Sentry.captureException(err, { tags: { source: "stripe_webhook_signature" } });
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Handle Stripe Workbench Snapshot thin events:
  // thin events only carry { id, object } (≤3 keys) in data.object — retrieve full payload if needed
  const rawDataObj = event.data.object as unknown as Record<string, unknown>;
  if (typeof rawDataObj.id === "string" && Object.keys(rawDataObj).length <= 3) {
    try {
      event = await stripe.events.retrieve(event.id);
    } catch (retrieveErr) {
      console.error("Webhook: failed to retrieve full event:", retrieveErr);
      return new NextResponse("Failed to retrieve event", { status: 500 });
    }
  }

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      type StripeSession = {
        id: string;
        currency?: string | null;
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
        sessionMeta.quotedShippingAmountCents != null &&
        sessionMeta.quotedShippingAmountCents !== ""
          ? Number(sessionMeta.quotedShippingAmountCents)
          : null;

      // Gift options from metadata
      const giftNote: string | null = sessionMeta.giftNote || null;
      const giftWrapping: boolean = sessionMeta.giftWrapping === "true";
      const giftWrappingPriceCentsRaw = sessionMeta.giftWrappingPriceCents ? parseInt(sessionMeta.giftWrappingPriceCents, 10) : null;
      const giftWrappingPriceCents: number | null = giftWrappingPriceCentsRaw != null && Number.isFinite(giftWrappingPriceCentsRaw) ? giftWrappingPriceCentsRaw : null;

      // Shippo IDs from metadata / selected shipping rate
      const shippoShipmentId: string | null = sessionMeta.shippoShipmentId || null;
      const selectedRateObjectId: string | null = sessionMeta.selectedRateObjectId || null;
      const shippoRateObjectId: string | null = selectedRateObjectId || shippingRateObj?.metadata?.objectId || null;

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
        type StripeLineItem = { quantity?: number | null; price?: { unit_amount?: number | null; product?: { metadata?: Record<string, string> } | string | null } | null };
        const stripeLineItems: StripeLineItem[] = (s as { line_items?: { data?: StripeLineItem[] } }).line_items?.data ?? [];
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
                    seller: { select: { displayName: true } },
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
          await releaseCheckoutLock(sessionMeta.checkoutLockKey);
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

              quotedToName: sessionMeta.quotedToName ?? null,
              quotedToPhone: sessionMeta.quotedToPhone ?? null,
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
              const current = await tx.listing.findUnique({
                where: { id: it.listingId },
                select: { stockQuantity: true },
              });
              if ((current?.stockQuantity ?? 0) <= 0) {
                await tx.listing.update({
                  where: { id: it.listingId },
                  data: { status: "SOLD_OUT" },
                });
              }
            }
          }

          await tx.cartItem.deleteMany({
            where: sellerIdFromMeta
              ? { cartId, listing: { sellerId: sellerIdFromMeta } }
              : { cartId },
          });
        });

        // Cart cleanup (separate try/catch — non-fatal)
        try {
          const webhookSellerId = sessionMeta.sellerId;
          if (webhookSellerId) {
            await prisma.cartItem.deleteMany({
              where: {
                cart: { userId: buyerId! },
                listing: { sellerId: webhookSellerId },
              },
            });
          }
        } catch (err) {
          console.error("Webhook cart cleanup failed:", err);
        }

        await releaseCheckoutLock(sessionMeta.checkoutLockKey);

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
      const quantity: number = Math.max(1, Number(sessionMeta.quantity || 1));
      const priceCentsFromMeta: number | null =
        sessionMeta.priceCents != null ? Number(sessionMeta.priceCents) : null;

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
            seller: { select: { displayName: true } },
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

          // Stock was already decremented at checkout time (reservation).
          // Just check if we need to mark SOLD_OUT.
          if (isInStock) {
            const currentSingle = await tx.listing.findUnique({
              where: { id: listingId },
              select: { stockQuantity: true },
            });
            if ((currentSingle?.stockQuantity ?? 0) <= 0) {
              await tx.listing.update({
                where: { id: listingId },
                data: { status: "SOLD_OUT" },
              });
            }
          }
        });

        // Cart cleanup (separate try/catch — non-fatal)
        try {
          const webhookSellerId = sessionMeta.sellerId;
          if (webhookSellerId) {
            await prisma.cartItem.deleteMany({
              where: {
                cart: { userId: buyerId! },
                listing: { sellerId: webhookSellerId },
              },
            });
          }
        } catch (err) {
          console.error("Webhook cart cleanup failed:", err);
        }

        await releaseCheckoutLock(sessionMeta.checkoutLockKey);

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
    }

    if (event.type === "account.updated") {
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
          const newChargesEnabled = Boolean(
            account.charges_enabled &&
            account.payouts_enabled &&
            account.details_submitted &&
            !account.requirements?.disabled_reason
          );
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

    if (event.type === "charge.refunded") {
      const charge = event.data.object as {
        id?: string;
        amount_refunded?: number;
        refunds?: { data?: Array<{ id?: string; amount?: number; status?: string | null }> };
      };
      if (charge.id) {
        const latestRefund = charge.refunds?.data?.find((refund) => refund.status !== "failed");
        const latestRefundId = latestRefund?.id ?? `external:${charge.id}`;
        const existingOrder = await prisma.order.findFirst({
          where: { stripeChargeId: charge.id },
          select: { id: true, sellerRefundId: true },
        });
        if (existingOrder && existingOrder.sellerRefundId !== latestRefundId) {
          await prisma.order.update({
            where: { id: existingOrder.id },
            data: {
              sellerRefundId: latestRefundId,
              sellerRefundAmountCents: charge.amount_refunded ?? latestRefund?.amount ?? 0,
              reviewNeeded: true,
              reviewNote: "Stripe refund was created outside Grainline.",
            },
          });
        }
      }
      return NextResponse.json({ received: true });
    }

    if (event.type.startsWith("charge.dispute.")) {
      const dispute = event.data.object as { id?: string; charge?: string | { id?: string } | null; amount?: number | null; reason?: string | null };
      const chargeId = typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id;
      if (chargeId) {
        const order = await prisma.order.findFirst({
          where: { stripeChargeId: chargeId },
          select: {
            id: true,
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
          await prisma.order.update({
            where: { id: order.id },
            data: {
              reviewNeeded: true,
              reviewNote: `Stripe dispute ${event.type}${dispute.reason ? `: ${dispute.reason}` : ""}`,
            },
          });
          const sellerUserId = order.items[0]?.listing.seller.userId;
          if (sellerUserId) {
            await createNotification({
              userId: sellerUserId,
              type: "CASE_OPENED",
              title: "Payment dispute opened",
              body: `Stripe reported a dispute for order ${order.id}.`,
              link: `/dashboard/sales/${order.id}`,
            });
          }
        }
      }
      return NextResponse.json({ received: true });
    }

    if (event.type === "payout.failed") {
      const accountId = (event as { account?: string }).account;
      if (accountId) {
        const seller = await prisma.sellerProfile.findFirst({
          where: { stripeAccountId: accountId },
          select: { userId: true },
        });
        if (seller) {
          await prisma.sellerProfile.updateMany({
            where: { stripeAccountId: accountId },
            data: { chargesEnabled: false, vacationMode: true },
          });
          await createNotification({
            userId: seller.userId,
            type: "VERIFICATION_REJECTED",
            title: "Payout failed",
            body: "Stripe could not complete a payout. Update your Stripe account before taking new orders.",
            link: "/dashboard/seller",
          });
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

    // CHECKOUT SESSION EXPIRED — restore reserved stock
    if (event.type === "checkout.session.expired") {
      const expiredSession = event.data.object as { id: string; metadata?: Record<string, string> };
      const expiredMeta = expiredSession.metadata ?? {};

      // Check this session didn't already create an order (edge case: completed + expired both fire)
      const orderExists = await prisma.order.findFirst({
        where: { stripeSessionId: expiredSession.id },
        select: { id: true },
      });
      if (orderExists) {
        await releaseCheckoutLock(expiredMeta.checkoutLockKey);
        return NextResponse.json({ ok: true }); // paid — don't restore
      }

      // Single-item checkout: restore the listing's stock
      const expiredListingId = expiredMeta.listingId;
      const expiredQuantity = Math.max(1, Number(expiredMeta.quantity || 1));
      if (expiredListingId) {
        await prisma.$executeRaw`
          UPDATE "Listing"
          SET "stockQuantity" = "stockQuantity" + ${expiredQuantity}
          WHERE id = ${expiredListingId}
            AND "listingType" = 'IN_STOCK'
        `;
        // If stock was 0 (SOLD_OUT from reservation), restore to ACTIVE
        await prisma.listing.updateMany({
          where: { id: expiredListingId, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
          data: { status: "ACTIVE" },
        });
      }

      // Cart checkout: restore stock for all items from this seller
      const expiredCartId = expiredMeta.cartId;
      const expiredSellerId = expiredMeta.sellerId;
      if (expiredCartId && expiredSellerId) {
        // We don't have the exact items from the session, but we stored
        // line_items in the session. Retrieve them from Stripe.
        try {
          const expiredS = await stripe.checkout.sessions.retrieve(expiredSession.id, {
            expand: ["line_items.data.price.product"],
          });
          type ExpiredLineItem = { quantity?: number | null; price?: { product?: { metadata?: Record<string, string> } | string | null } | null };
          const expiredLineItems: ExpiredLineItem[] = (expiredS as { line_items?: { data?: ExpiredLineItem[] } }).line_items?.data ?? [];
          for (const li of expiredLineItems) {
            const prod = typeof li.price?.product === "object" ? li.price?.product : null;
            const lid = prod?.metadata?.listingId;
            if (lid && li.quantity) {
              await prisma.$executeRaw`
                UPDATE "Listing"
                SET "stockQuantity" = "stockQuantity" + ${li.quantity}
                WHERE id = ${lid}
                  AND "listingType" = 'IN_STOCK'
              `;
              await prisma.listing.updateMany({
                where: { id: lid, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
                data: { status: "ACTIVE" },
              });
            }
          }
        } catch (err) {
          console.error("Failed to restore stock for expired cart session:", err);
        }
      }

      await releaseCheckoutLock(expiredMeta.checkoutLockKey);

      return NextResponse.json({ ok: true });
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
    return new NextResponse("Webhook error", { status: 500 });
  }
}
