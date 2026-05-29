// src/app/api/cart/checkout-seller/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { verifyRate } from "@/lib/shipping-token";
import { safeRateLimit, checkoutRatelimit } from "@/lib/ratelimit";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { calculateCheckoutAmounts } from "@/lib/checkoutAmounts";
import { resolveListingVariantSelection, type SelectedVariantSnapshot } from "@/lib/listingVariants";
import { stripeStatementDescriptorSuffix } from "@/lib/stripeStatementDescriptor";
import {
  acquireCheckoutLock,
  cartCheckoutLockKey,
  checkoutPayloadHash,
  getCheckoutLock,
  markCheckoutLockReady,
  releaseCheckoutLock,
} from "@/lib/checkoutSessionLock";
import {
  CheckoutStockReservationStockError,
  checkoutStockReservationMetadata,
  createCheckoutStockReservation,
  markCheckoutStockReservationSession,
  restoreCheckoutStockReservationOnce,
  restoreUnorderedCheckoutStockOnce,
} from "@/lib/checkoutStockRestore";
import { sanitizeEmailOutboxError } from "@/lib/emailOutboxSanitize";
import { logSecurityEvent } from "@/lib/security";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { SHIPPING_ESTIMATED_DAYS_MAX } from "@/lib/stripeWebhookState";
import { normalizeCheckoutShippingAddress } from "@/lib/addressFields";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { APP_BASE_URL } from "@/lib/appBaseUrl";

const CheckoutSellerSchema = z.object({
  sellerId: z.string().min(1),
  shippingAddress: z.object({
    name: z.string().min(1).max(100),
    line1: z.string().min(1).max(200),
    line2: z.string().max(200).optional().nullable(),
    city: z.string().min(1).max(100),
    state: z.string().length(2),
    postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
    phone: z.string().max(20).optional().nullable(),
  }),
  selectedRate: z.object({
    objectId: z.string().min(1),
    amountCents: z.number().int().min(0),
    displayName: z.string().min(1).max(100),
    carrier: z.string().max(100),
    estDays: z.number().int().min(1).max(SHIPPING_ESTIMATED_DAYS_MAX).nullable(),
    token: z.string().min(1),
    expiresAt: z.number().int().min(0),
  }),
  giftNote: z.string().max(200).optional().nullable(),
  giftWrapping: z.boolean().optional().default(false),
});

export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";
const CHECKOUT_BODY_MAX_BYTES = 64 * 1024;

export async function POST(req: Request) {
  let checkoutReservationId: string | null = null;
  let checkoutReservationItemCount = 0;
  let checkoutLockKeyValue: string | null = null;
  let checkoutLockAcquired = false;

  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const rl = await safeRateLimit(checkoutRatelimit, userId);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many requests. Please try again in a moment." },
        { status: 429 }
      );
    }

    const me = await ensureUserByClerkId(userId);

    let body;
    try {
      body = CheckoutSellerSchema.parse(await readBoundedJson(req, CHECKOUT_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return NextResponse.json({ error: "Request body too large" }, { status: 413 });
      }
      if (isInvalidJsonBodyError(e)) {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      throw e;
    }
    const shippingAddress = normalizeCheckoutShippingAddress(body.shippingAddress);
    if (!shippingAddress.name || !shippingAddress.line1 || !shippingAddress.city) {
      return NextResponse.json({ error: "Shipping address is incomplete." }, { status: 400 });
    }
    const sellerId = body.sellerId;

    const giftNote = body.giftNote ? truncateText(sanitizeText(body.giftNote), 200) : "";
    const giftWrapping: boolean = body.giftWrapping === true;
    // Gift wrap price is resolved below from the seller's server-side
    // giftWrappingPriceCents — do NOT trust client input for this.

    // Fetch buyer email for tax calculation
    const userWithEmail = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { email: true },
    });
    const buyerEmail = userWithEmail?.email;
    if (!buyerEmail) {
      return NextResponse.json({ error: "Buyer email required for tax calculation" }, { status: 400 });
    }

    // Load cart (filter items to this seller)
    const cart = await prisma.cart.findUnique({
      where: { userId: me.id },
      include: {
        items: {
          include: {
            listing: {
              include: {
                seller: { include: { user: { select: { banned: true, deletedAt: true } } } },
                photos: true,
                variantGroups: { include: { options: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!cart) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });

    const cartSellerCount = new Set(cart.items.map((it) => it.listing.sellerId)).size;
    const sellerItems = cart.items.filter((it) => it.listing.sellerId === sellerId);
    if (sellerItems.length === 0) {
      return NextResponse.json({ error: "No items for this seller" }, { status: 400 });
    }

    const currency = (sellerItems[0].listing.currency || DEFAULT_CURRENCY).toLowerCase();
    const mixedCurrencyItem = sellerItems.find(
      (item) => (item.listing.currency || DEFAULT_CURRENCY).toLowerCase() !== currency,
    );
    if (mixedCurrencyItem) {
      return NextResponse.json(
        { error: "Items with different currencies cannot be checked out together." },
        { status: 400 },
      );
    }
    const destination = sellerItems[0].listing.seller.stripeAccountId || null;
    const sellerChargesEnabled = sellerItems[0].listing.seller.chargesEnabled ?? false;

    const sellerBlockReason = sellerOrderBlockReason(sellerItems[0].listing.seller);
    if (sellerBlockReason) {
      return NextResponse.json(
        {
          error: sellerOrderBlockMessage(sellerBlockReason),
          blockedSellers: [{ sellerId, reason: sellerBlockReason }],
        },
        { status: 400 },
      );
    }

    // Pre-flight: verify seller can accept payments
    if (!destination || !sellerChargesEnabled) {
      return NextResponse.json({ error: "This seller is not currently accepting orders. Please try again later." }, { status: 400 });
    }

    // Block self-purchase (Stripe ToS violation)
    if (sellerItems[0].listing.seller.userId === me.id) {
      return NextResponse.json(
        { error: "You cannot purchase your own listings." },
        { status: 400 },
      );
    }

    // Only ACTIVE listings are purchasable.
    // Blocks DRAFT, SOLD, SOLD_OUT, HIDDEN, PENDING_REVIEW, REJECTED.
    const inactiveItem = sellerItems.find(
      (it) => it.listing.status !== "ACTIVE",
    );
    if (inactiveItem) {
      return NextResponse.json(
        { error: `"${inactiveItem.listing.title}" is no longer available.` },
        { status: 400 },
      );
    }

    // Private/reserved listings: only the reserved buyer can purchase.
    const privateItem = sellerItems.find(
      (it) =>
        it.listing.isPrivate &&
        it.listing.reservedForUserId !== me.id,
    );
    if (privateItem) {
      return NextResponse.json(
        { error: "One or more items in your cart are not available for purchase." },
        { status: 400 },
      );
    }

    // Gift wrapping: reject if buyer requested it but seller does not offer it.
    if (giftWrapping && !sellerItems[0].listing.seller.offersGiftWrapping) {
      return NextResponse.json(
        { error: "This seller does not offer gift wrapping." },
        { status: 400 },
      );
    }

    // Gift wrap price: sourced server-side from the seller's profile.
    // Client input for this amount is ignored to prevent price manipulation.
    const giftWrappingPriceCents: number = giftWrapping
      ? (sellerItems[0].listing.seller.giftWrappingPriceCents ?? 0)
      : 0;

    const resolvedSellerItems: Array<(typeof sellerItems)[number] & {
      unitPriceCents: number;
      variantKey: string;
      selectedVariantLabels: string[];
      selectedVariantsSnapshot: SelectedVariantSnapshot[];
    }> = [];

    for (const item of sellerItems) {
      if (item.listing.listingType === "MADE_TO_ORDER" && item.quantity !== 1) {
        return NextResponse.json(
          { error: `"${item.listing.title}" can only be ordered one at a time.` },
          { status: 400 },
        );
      }
      if (item.listing.listingType === "IN_STOCK") {
        const available = item.listing.stockQuantity ?? 0;
        if (available <= 0) {
          return NextResponse.json(
            { error: `"${item.listing.title}" is currently out of stock.` },
            { status: 400 },
          );
        }
        if (item.quantity > available) {
          return NextResponse.json(
            { error: `Only ${available} available for "${item.listing.title}".` },
            { status: 400 },
          );
        }
      }

      const variantResolution = resolveListingVariantSelection(
        item.listing.variantGroups,
        item.selectedVariantOptionIds ?? [],
      );
      if (!variantResolution.ok) {
        return NextResponse.json(
          { error: `"${item.listing.title}": ${variantResolution.error}` },
          { status: 400 },
        );
      }

      const unitPriceCents = item.listing.priceCents + variantResolution.variantAdjustCents;
      if (unitPriceCents < 1) {
        return NextResponse.json(
          { error: `"${item.listing.title}" has an invalid variant price.` },
          { status: 400 },
        );
      }
      if (unitPriceCents !== item.priceCents || item.priceVersion !== item.listing.priceVersion) {
        await prisma.cartItem.update({
          where: { id: item.id },
          data: {
            priceCents: unitPriceCents,
            priceVersion: item.listing.priceVersion,
          },
        });
        return NextResponse.json(
          {
            error: "Price changed since this item was added to your cart. Review your cart before checking out.",
            code: "PRICE_CHANGED",
            cartItemId: item.id,
            listingId: item.listingId,
            oldPriceCents: item.priceCents,
            newPriceCents: unitPriceCents,
            oldPriceVersion: item.priceVersion,
            newPriceVersion: item.listing.priceVersion,
          },
          { status: 409 },
        );
      }
      resolvedSellerItems.push({
        ...item,
        unitPriceCents,
        variantKey: variantResolution.variantKey,
        selectedVariantLabels: variantResolution.selectedVariantLabels,
        selectedVariantsSnapshot: variantResolution.selectedVariantsSnapshot,
      });
    }

    // Verify every shipping rate, including fallback. Fallback rates must be
    // signed by /api/shipping/quote; clients cannot force the fallback objectId.
    const contextId = body.sellerId;
    const rateVerification = verifyRate(
      {
        objectId: body.selectedRate.objectId,
        amountCents: body.selectedRate.amountCents,
        displayName: body.selectedRate.displayName,
        carrier: body.selectedRate.carrier,
        estDays: body.selectedRate.estDays,
        contextId,
        buyerId: me.id,
        buyerPostal: shippingAddress.postalCode,
      },
      body.selectedRate.token,
      body.selectedRate.expiresAt,
    );

    if (!rateVerification.ok) {
      if (rateVerification.status === 400) {
        logSecurityEvent("token_rejected", {
          userId: me.id,
          route: "/api/cart/checkout-seller",
          reason: "invalid shipping rate token",
          sellerId: body.sellerId,
          objectIdPresent: !!body.selectedRate.objectId,
          tokenLength: body.selectedRate.token.length,
        });
      }
      return NextResponse.json(
        { error: rateVerification.error },
        { status: rateVerification.status },
      );
    }

    // Stripe line items
    const line_items: {
      quantity: number;
      price_data: { currency: string; unit_amount: number; product_data: { name: string; images?: string[]; metadata?: Record<string, string>; tax_code?: string } };
    }[] = resolvedSellerItems.map((i) => {
      const variantSuffix = i.selectedVariantLabels.length > 0 ? ` (${i.selectedVariantLabels.join(", ")})` : "";
      return {
        quantity: i.quantity,
        price_data: {
          currency,
          unit_amount: i.unitPriceCents,
          product_data: {
            name: `${i.listing.title}${variantSuffix}`,
            images: i.listing.photos?.length ? [i.listing.photos[0]!.url] : undefined,
            metadata: {
              listingId: i.listing.id,
              cartItemId: i.id,
              variantKey: i.variantKey,
            },
            tax_code: "txcd_99999999", // General - Tangible Personal Property
          },
        },
      };
    });

    if (giftWrapping && giftWrappingPriceCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: giftWrappingPriceCents,
          product_data: { name: "Gift Wrapping", tax_code: "txcd_99999999" },
        },
      });
    }

    const itemsSubtotalCents = resolvedSellerItems.reduce(
      (sum, it) => sum + it.unitPriceCents * it.quantity,
      0
    );

    // Amount is trusted because the selected rate was signed above.
    const shippingAmountCents = body.selectedRate.amountCents;

    const giftWrapCents = giftWrapping ? giftWrappingPriceCents : 0;
    const checkoutAmounts = calculateCheckoutAmounts({
      itemsSubtotalCents,
      shippingAmountCents,
      giftWrapCents,
    });
    const sellerTransferAmount = checkoutAmounts.sellerTransferAmountCents;

    if (checkoutAmounts.belowMinimumSellerTransfer) {
      return NextResponse.json(
        { error: "Order total is too low after fees. Minimum effective order is approximately $2." },
        { status: 400 },
      );
    }

    checkoutLockKeyValue = cartCheckoutLockKey(cart.id, sellerId);
    const payloadHash = checkoutPayloadHash({
      buyerId: me.id,
      cartId: cart.id,
      sellerId,
      items: resolvedSellerItems.map((it) => ({
        cartItemId: it.id,
        listingId: it.listingId,
        quantity: it.quantity,
        variantKey: it.variantKey,
        unitPriceCents: it.unitPriceCents,
      })),
      shippingAddress,
      selectedRate: {
        objectId: body.selectedRate.objectId,
        amountCents: shippingAmountCents,
        estDays: body.selectedRate.estDays,
      },
      giftWrapping,
      giftNote,
    });

    const existingCheckoutLock = await getCheckoutLock(checkoutLockKeyValue);
    if (existingCheckoutLock) {
      if (
        existingCheckoutLock.payloadHash === payloadHash &&
        existingCheckoutLock.state === "ready" &&
        existingCheckoutLock.clientSecret &&
        existingCheckoutLock.sessionId
      ) {
        return NextResponse.json({
          clientSecret: existingCheckoutLock.clientSecret,
          sessionId: existingCheckoutLock.sessionId,
          reused: true,
        });
      }
      return NextResponse.json(
        { error: "A checkout session is already open for this seller. Complete payment in the Stripe tab or wait up to 31 minutes for the reservation to expire." },
        { status: 409 },
      );
    }

    checkoutLockAcquired = await acquireCheckoutLock(checkoutLockKeyValue, payloadHash);
    if (!checkoutLockAcquired) {
      const racedCheckoutLock = await getCheckoutLock(checkoutLockKeyValue);
      if (
        racedCheckoutLock?.payloadHash === payloadHash &&
        racedCheckoutLock.state === "ready" &&
        racedCheckoutLock.clientSecret &&
        racedCheckoutLock.sessionId
      ) {
        return NextResponse.json({
          clientSecret: racedCheckoutLock.clientSecret,
          sessionId: racedCheckoutLock.sessionId,
          reused: true,
        });
      }
      return NextResponse.json(
        { error: "A checkout session is already being prepared. Please try again in a moment." },
        { status: 409 },
      );
    }

    const reservableItems = resolvedSellerItems
      .filter((it) => it.listing.listingType === "IN_STOCK")
      .map((it) => ({
        listingId: it.listing.id,
        sellerId: it.listing.sellerId,
        quantity: it.quantity,
        title: it.listing.title,
      }));
    checkoutReservationItemCount = reservableItems.length;
    try {
      const reservation = await createCheckoutStockReservation({
        checkoutLockKey: checkoutLockKeyValue,
        payloadHash,
        buyerId: me.id,
        sellerId,
        items: reservableItems,
      });
      checkoutReservationId = reservation?.id ?? null;
    } catch (reservationError) {
      await releaseCheckoutLock(checkoutLockKeyValue);
      if (reservationError instanceof CheckoutStockReservationStockError) {
        const item = reservableItems.find((candidate) => candidate.listingId === reservationError.listingId);
        return NextResponse.json(
          { error: item ? `"${item.title}" does not have enough stock.` : "One or more items do not have enough stock." },
          { status: 400 },
        );
      }
      throw reservationError;
    }

    const return_url = `${APP_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;

    const csDescriptor = stripeStatementDescriptorSuffix(sellerItems[0].listing.seller.displayName);
    const reservedStockMetadata = reservableItems
      .map((item) => `${item.listingId}:${item.quantity}`)
      .join(",");
    const checkoutMetadata: Record<string, string> = {
      cartId: cart.id,
      buyerId: me.id,
      sellerId,
      taxRetainedAtCreation: "true",
      selectedRateObjectId: body.selectedRate.objectId,
      quotedToName: shippingAddress.name,
      quotedToLine1: shippingAddress.line1,
      quotedToLine2: shippingAddress.line2 ?? "",
      quotedToCity: shippingAddress.city,
      quotedToState: shippingAddress.state,
      quotedToPostalCode: shippingAddress.postalCode,
      quotedToCountry: "US",
      quotedToPhone: shippingAddress.phone ?? "",
      quotedShippingAmountCents: String(shippingAmountCents),
      giftNote: giftNote ?? "",
      giftWrapping: giftWrapping ? "true" : "false",
      giftWrappingPriceCents: giftWrapping && giftWrappingPriceCents > 0 ? String(giftWrappingPriceCents) : "",
      cartSellerCount: String(cartSellerCount),
      multiSellerCheckout: cartSellerCount > 1 ? "true" : "false",
      checkoutLockKey: checkoutLockKeyValue,
      ...checkoutStockReservationMetadata(checkoutReservationId),
      ...(reservedStockMetadata.length <= 500 ? { reservedStock: reservedStockMetadata } : {}),
    };

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      redirect_on_completion: "if_required",
      // ~30-minute expiry — stock is reserved at checkout, restored on expiry.
      // 31 min (not 30) provides a buffer against clock skew — Stripe's minimum is 30.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      mode: "payment",
      payment_method_types: ["card"],
      return_url,
      line_items,
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shippingAmountCents, currency },
            display_name: body.selectedRate.displayName,
            tax_behavior: "exclusive",
            metadata: {
              objectId: body.selectedRate.objectId,
              estDays: body.selectedRate.estDays != null ? String(body.selectedRate.estDays) : "",
            },
          },
        },
      ],
      customer_email: buyerEmail,
      automatic_tax: { enabled: true, liability: { type: "self" as const } },
      payment_intent_data: {
        transfer_data: {
          destination,
          // Platform fee is retained by transferring only the seller portion.
          // Do not also set application_fee_amount with this manual transfer model.
          amount: sellerTransferAmount,
        },
        statement_descriptor_suffix: csDescriptor,
      },
      metadata: checkoutMetadata,
    });

    if (checkoutReservationId) {
      const reservationSessionRecorded = await markCheckoutStockReservationSession({
        reservationId: checkoutReservationId,
        payloadHash,
        sessionId: session.id,
      });
      if (!reservationSessionRecorded) {
        Sentry.captureMessage("Checkout stock reservation session transition rejected", {
          level: "warning",
          tags: { source: "checkout_stock_reservation_session", route: "cart_checkout_seller" },
          extra: { checkoutReservationId, stripeSessionId: session.id },
        });
        let staleSessionExpired = false;
        await stripe.checkout.sessions.expire(session.id).then(() => {
          staleSessionExpired = true;
        }).catch((error) => {
          Sentry.captureException(error, { tags: { source: "checkout_stock_reservation_expire_stale" } });
        });
        if (staleSessionExpired) {
          await restoreCheckoutStockReservationOnce({
            reservationId: checkoutReservationId,
            sessionId: session.id,
            reason: "session_record_failed",
          }).catch((error) => {
            Sentry.captureException(error, { tags: { source: "checkout_stock_reservation_restore_stale" } });
          });
        }
        return NextResponse.json(
          { error: "Checkout state changed. Please try again." },
          { status: 409 },
        );
      }
    }

    try {
      const lockMarkedReady = await markCheckoutLockReady(
        checkoutLockKeyValue,
        payloadHash,
        session.id,
        session.client_secret,
      );
      if (!lockMarkedReady) {
        Sentry.captureMessage("Checkout lock ready transition rejected", {
          level: "warning",
          tags: { source: "checkout_lock_ready", route: "cart_checkout_seller" },
          extra: { checkoutLockKey: checkoutLockKeyValue, stripeSessionId: session.id },
        });
        let staleSessionExpired = false;
        await stripe.checkout.sessions.expire(session.id).then(() => {
          staleSessionExpired = true;
        }).catch((error) => {
          Sentry.captureException(error, { tags: { source: "checkout_lock_expire_stale" } });
        });
        if (staleSessionExpired) {
          await restoreUnorderedCheckoutStockOnce({
            sessionId: session.id,
            metadata: checkoutMetadata,
          }).catch((error) => {
            Sentry.captureException(error, { tags: { source: "checkout_lock_restore_stale" } });
          });
        }
        return NextResponse.json(
          { error: "Checkout state changed. Please try again." },
          { status: 409 },
        );
      }
    } catch (lockErr) {
      Sentry.captureException(lockErr, { tags: { source: "checkout_lock_ready" } });
    }

    return NextResponse.json({ clientSecret: session.client_secret, sessionId: session.id });
  } catch (err: unknown) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    Sentry.captureException(err, {
      tags: { source: "checkout_seller_route", route: "/api/cart/checkout-seller" },
      extra: {
        checkoutReservationId,
        reservedItemCount: checkoutReservationItemCount,
        checkoutLockAcquired,
      },
    });
    console.error("POST /api/cart/checkout-seller error:", sanitizeEmailOutboxError(err));

    if (checkoutReservationId) {
      await restoreCheckoutStockReservationOnce({
        reservationId: checkoutReservationId,
        reason: "checkout_create_error",
        releaseLock: false,
      }).catch((restoreError) => {
        Sentry.captureException(restoreError, {
          level: "warning",
          tags: { source: "checkout_stock_restore_failed", route: "cart_checkout_seller" },
          extra: { checkoutReservationId, reason: "checkout_create_error" },
        });
      });
    }

    if (checkoutLockAcquired) {
      await releaseCheckoutLock(checkoutLockKeyValue);
    }

    const msg = err instanceof Error ? err.message : "Server error creating checkout session";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
