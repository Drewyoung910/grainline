import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isFallbackRate } from "@/types/checkout";
import { shippingRateExpiresAtIsTooFarFuture, shippingRateSubjectHash, verifyRate } from "@/lib/shipping-token";
import { resolveListingVariantSelection, validateVariantUnitPriceCents } from "@/lib/listingVariants";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { calculateCheckoutAmounts } from "@/lib/checkoutAmounts";
import { stripeStatementDescriptorSuffix } from "@/lib/stripeStatementDescriptor";
import {
  acquireCheckoutLock,
  checkoutPayloadHash,
  getCheckoutLock,
  markCheckoutLockReady,
  releaseCheckoutLock,
  singleCheckoutLockKey,
} from "@/lib/checkoutSessionLock";
import {
  CheckoutStockReservationStockError,
  checkoutStockReservationMetadata,
  createCheckoutStockReservation,
  markCheckoutStockReservationSession,
  restoreCheckoutStockReservationOnce,
  restoreUnorderedCheckoutStockOnce,
} from "@/lib/checkoutStockRestore";
import { sanitizeText, truncateText } from "@/lib/sanitize";
import { logSecurityEvent } from "@/lib/security";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { isPickupRateObjectId } from "@/lib/shippingQuoteState";
import { SHIPPING_ESTIMATED_DAYS_MAX } from "@/lib/stripeWebhookState";
import { normalizeCheckoutShippingAddress } from "@/lib/addressFields";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { APP_BASE_URL } from "@/lib/appBaseUrl";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { hashIdentifierForTelemetry } from "@/lib/privacyTelemetry";

const CheckoutSingleSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
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
    currency: z.string().length(3),
    displayName: z.string().min(1).max(100),
    carrier: z.string().max(100),
    estDays: z.number().int().min(1).max(SHIPPING_ESTIMATED_DAYS_MAX).nullable(),
    subjectHash: z.string().min(1).max(64),
    token: z.string().min(1),
    expiresAt: z.number().int().min(0).refine(
      (expiresAt) => !shippingRateExpiresAtIsTooFarFuture(expiresAt),
      "Shipping rate expiry is too far in the future.",
    ),
  }),
  giftNote: z.string().max(200).optional().nullable(),
  giftWrapping: z.boolean().optional().default(false),
  selectedVariantOptionIds: z.array(z.string()).max(30).optional().default([]),
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
    if (!userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many checkout attempts."));

    const me = await ensureUserByClerkId(userId);

    let body;
    try {
      body = CheckoutSingleSchema.parse(await readBoundedJson(req, CHECKOUT_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (e instanceof z.ZodError) {
        return privateJson({ error: "Invalid input", details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      throw e;
    }
    const shippingAddress = normalizeCheckoutShippingAddress(body.shippingAddress);
    if (!shippingAddress.name || !shippingAddress.line1 || !shippingAddress.city) {
      return privateJson({ error: "Shipping address is incomplete." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const listing = await prisma.listing.findUnique({
      where: { id: body.listingId },
      include: {
        photos: true,
        seller: {
          select: {
            userId: true,
            displayName: true,
            stripeAccountId: true,
            stripeAccountVersion: true,
            chargesEnabled: true,
            vacationMode: true,
            acceptingNewOrders: true,
            allowLocalPickup: true,
            offersGiftWrapping: true,
            giftWrappingPriceCents: true,
            defaultPkgWeightGrams: true,
            defaultPkgLengthCm: true,
            defaultPkgWidthCm: true,
            defaultPkgHeightCm: true,
            user: { select: { banned: true, deletedAt: true } },
          },
        },
        variantGroups: { include: { options: true } },
      },
    });
    if (!listing) return privateJson({ error: "Listing not found" }, { status: HTTP_STATUS.NOT_FOUND });

    // Only ACTIVE listings are purchasable.
    // Blocks DRAFT, SOLD, SOLD_OUT, HIDDEN, PENDING_REVIEW, REJECTED.
    if (listing.status !== "ACTIVE") {
      return privateJson(
        { error: "This listing is not currently available." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Private/reserved listings: only the reserved buyer can purchase.
    if (listing.isPrivate && listing.reservedForUserId !== me.id) {
      return privateJson(
        { error: "This listing is not available for purchase." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    if (listing.seller.userId === me.id) {
      return privateJson({ error: "You cannot buy your own listing." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const sellerBlockReason = sellerOrderBlockReason(listing.seller);
    if (sellerBlockReason) {
      return privateJson(
        { error: sellerOrderBlockMessage(sellerBlockReason) },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    if (listing.listingType === "MADE_TO_ORDER" && body.quantity > 1) {
      return privateJson(
        { error: "Made-to-order items can only be ordered one at a time." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }
    if (listing.listingType === "IN_STOCK") {
      const available = listing.stockQuantity ?? 0;
      if (available <= 0) {
        return privateJson({ error: "This item is currently out of stock." }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (body.quantity > available) {
        return privateJson({ error: `Only ${available} available.` }, { status: HTTP_STATUS.BAD_REQUEST });
      }
    }

    const currency = (listing.currency || DEFAULT_CURRENCY).toLowerCase();
    if (body.selectedRate.currency.toLowerCase() !== currency) {
      return privateJson({ error: "Invalid shipping rate currency." }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    const sellerStripeAccountId = listing.seller.stripeAccountId || null;
    const sp = listing.seller;

    // Pre-flight: verify seller can accept payments
    if (!sellerStripeAccountId || !sp.chargesEnabled) {
      return privateJson(
        { error: "This seller is not currently accepting orders. Please try again later." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Gift wrapping: reject if buyer requested it but seller does not offer it.
    if (body.giftWrapping && !listing.seller.offersGiftWrapping) {
      return privateJson(
        { error: "This seller does not offer gift wrapping." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Verify every shipping rate, including fallback. Fallback rates must be
    // signed by /api/shipping/quote; clients cannot force the fallback objectId.
    const contextId = body.listingId;
    const subjectHash = shippingRateSubjectHash({
      mode: "single",
      listingId: listing.id,
      quantity: body.quantity,
      weight: listing.packagedWeightGrams ?? listing.seller.defaultPkgWeightGrams ?? 0,
      length: listing.packagedLengthCm ?? listing.seller.defaultPkgLengthCm ?? 0,
      width: listing.packagedWidthCm ?? listing.seller.defaultPkgWidthCm ?? 0,
      height: listing.packagedHeightCm ?? listing.seller.defaultPkgHeightCm ?? 0,
    });
    const rateVerification = verifyRate(
      {
        objectId: body.selectedRate.objectId,
        amountCents: body.selectedRate.amountCents,
        currency,
        displayName: body.selectedRate.displayName,
        carrier: body.selectedRate.carrier,
        estDays: body.selectedRate.estDays,
        contextId,
        buyerId: me.id,
        buyerPostal: shippingAddress.postalCode,
        subjectHash,
      },
      body.selectedRate.token,
      body.selectedRate.expiresAt,
    );

    if (!rateVerification.ok) {
      if (rateVerification.status === HTTP_STATUS.BAD_REQUEST) {
        logSecurityEvent("token_rejected", {
          userId: me.id,
          route: "/api/cart/checkout/single",
          reason: "invalid shipping rate token",
          listingId: body.listingId,
          objectIdPresent: !!body.selectedRate.objectId,
          tokenLength: body.selectedRate.token.length,
        });
      }
      return privateJson(
        { error: rateVerification.error },
        { status: rateVerification.status },
      );
    }

    if (isPickupRateObjectId(body.selectedRate.objectId) && !listing.seller.allowLocalPickup) {
      return privateJson(
        { error: "Local pickup is no longer available for this seller. Please re-select a shipping option." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    // Variant validation + price calculation — MUST come before stock reservation
    // to avoid stock leaks on validation failures.
    const variantResolution = resolveListingVariantSelection(
      listing.variantGroups,
      body.selectedVariantOptionIds,
    );
    if (!variantResolution.ok) {
      return privateJson({ error: variantResolution.error }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const selectedVariantLabels = variantResolution.selectedVariantLabels;
    const selectedVariantsSnapshot = variantResolution.selectedVariantsSnapshot;
    const unitPriceCents = listing.priceCents + variantResolution.variantAdjustCents;
    const unitPriceError = validateVariantUnitPriceCents(unitPriceCents);
    if (unitPriceError) {
      return privateJson({ error: unitPriceError }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    // Resolve shipping amount from the signed selected rate.
    const isFallback = isFallbackRate(body.selectedRate);
    const shippingAmountCents = body.selectedRate.amountCents;

    // Gift wrap price is sourced server-side from the seller's profile
    const giftWrapCents = body.giftWrapping
      ? (listing.seller.giftWrappingPriceCents ?? 0)
      : 0;

    const itemsSubtotalCents = unitPriceCents * body.quantity;
    const checkoutAmounts = calculateCheckoutAmounts({
      itemsSubtotalCents,
      shippingAmountCents,
      giftWrapCents,
    });

    // Seller receives items + shipping + gift wrap - platform fee.
    // Platform absorbs Stripe processing fees from the platform fee.
    // Tax is excluded — platform retains tax (marketplace facilitator).
    const sellerTransferAmount = checkoutAmounts.sellerTransferAmountCents;

    // Block orders where the effective payout is under $1.
    if (checkoutAmounts.belowMinimumSellerTransfer) {
      return privateJson(
        { error: "Order total is too low after fees. Minimum effective order is approximately $2." },
        { status: HTTP_STATUS.BAD_REQUEST },
      );
    }

    checkoutLockKeyValue = singleCheckoutLockKey(me.id, listing.id);
    const payloadHash = checkoutPayloadHash({
      buyerId: me.id,
      listingId: listing.id,
      quantity: body.quantity,
      variantKey: variantResolution.variantKey,
      unitPriceCents,
      shippingAddress,
      selectedRate: {
        objectId: body.selectedRate.objectId,
        amountCents: shippingAmountCents,
        currency,
        estDays: body.selectedRate.estDays,
      },
      giftWrapping: body.giftWrapping === true,
      giftNote: body.giftNote ? truncateText(sanitizeText(body.giftNote), 200) : "",
    });

    const existingCheckoutLock = await getCheckoutLock(checkoutLockKeyValue);
    if (existingCheckoutLock) {
      if (
        existingCheckoutLock.payloadHash === payloadHash &&
        existingCheckoutLock.state === "ready" &&
        existingCheckoutLock.clientSecret &&
        existingCheckoutLock.sessionId
      ) {
        return privateJson({
          clientSecret: existingCheckoutLock.clientSecret,
          sessionId: existingCheckoutLock.sessionId,
          reused: true,
        });
      }
      return privateJson(
        { error: "A checkout session is already open for this listing. Complete payment in the Stripe tab or wait up to 31 minutes for the reservation to expire." },
        { status: HTTP_STATUS.CONFLICT },
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
        return privateJson({
          clientSecret: racedCheckoutLock.clientSecret,
          sessionId: racedCheckoutLock.sessionId,
          reused: true,
        });
      }
      return privateJson(
        { error: "A checkout session is already being prepared. Please try again in a moment." },
        { status: HTTP_STATUS.CONFLICT },
      );
    }

    const reservableItems = listing.listingType === "IN_STOCK"
      ? [{
          listingId: listing.id,
          sellerId: listing.sellerId,
          quantity: body.quantity,
          title: listing.title,
        }]
      : [];
    checkoutReservationItemCount = reservableItems.length;
    try {
      const reservation = await createCheckoutStockReservation({
        checkoutLockKey: checkoutLockKeyValue,
        payloadHash,
        buyerId: me.id,
        sellerId: listing.sellerId,
        items: reservableItems,
      });
      checkoutReservationId = reservation?.id ?? null;
    } catch (reservationError) {
      await releaseCheckoutLock(checkoutLockKeyValue);
      if (reservationError instanceof CheckoutStockReservationStockError) {
        return privateJson(
          { error: "Not enough stock available for this item." },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      throw reservationError;
    }

    // Variant description suffix for Stripe line item name
    const variantDesc = selectedVariantLabels.length > 0
      ? ` (${selectedVariantLabels.join(", ")})`
      : "";

    // Line items
    const line_items: {
      quantity: number;
      price_data: {
        currency: string;
        unit_amount: number;
        product_data: { name: string; images?: string[]; metadata?: Record<string, string>; tax_code?: string };
      };
    }[] = [
      {
        quantity: body.quantity,
        price_data: {
          currency,
          unit_amount: unitPriceCents,
          product_data: {
            name: `${listing.title}${variantDesc}`,
            images: listing.photos.length ? [listing.photos[0].url] : undefined,
            metadata: { listingId: listing.id },
            tax_code: "txcd_99999999", // General - Tangible Personal Property
          },
        },
      },
    ];

    if (body.giftWrapping && giftWrapCents > 0) {
      line_items.push({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: giftWrapCents,
          product_data: { name: "Gift Wrapping", tax_code: "txcd_99999999" },
        },
      });
    }

    // Buyer email (for Stripe receipt)
    const buyerEmail = me.email ?? undefined;

    // Statement descriptor: shows seller name on buyer's card statement
    const descriptorSuffix = stripeStatementDescriptorSuffix(sp.displayName);
    const selectedVariantsMetadata = (() => {
      if (selectedVariantsSnapshot.length === 0) return "";
      const json = JSON.stringify(selectedVariantsSnapshot);
      if (json.length <= 500) return json;
      const compactJson = JSON.stringify(
        selectedVariantsSnapshot.map((v) => ({
          groupName: truncateText(v.groupName, 20),
          optionLabel: truncateText(v.optionLabel, 20),
          priceAdjustCents: v.priceAdjustCents,
        }))
      );
      return truncateText(compactJson, 500);
    })();
    const checkoutMetadata: Record<string, string> = {
      listingId: body.listingId,
      sellerId: listing.sellerId,
      quantity: String(body.quantity),
      priceCents: String(unitPriceCents),
      priceVersion: String(listing.priceVersion),
      buyerId: me.id,
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
      itemsSubtotalCents: String(itemsSubtotalCents),
      giftNote: body.giftNote ? truncateText(sanitizeText(body.giftNote), 200) : "",
      giftWrapping: body.giftWrapping ? "true" : "false",
      giftWrappingPriceCents: body.giftWrapping ? String(giftWrapCents) : "",
      selectedVariants: selectedVariantsMetadata,
      checkoutLockKey: checkoutLockKeyValue,
      ...checkoutStockReservationMetadata(checkoutReservationId),
      reservedStock: `${body.listingId}:${body.quantity}`,
    };

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      // CRITICAL: "if_required" lets onComplete fire for card payments.
      // "always" (the default) redirects instead of firing onComplete.
      redirect_on_completion: "if_required",
      // ~30-minute expiry — stock is reserved at checkout, restored on expiry.
      // 31 min (not 30) provides a buffer against clock skew — Stripe's minimum is 30.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      return_url: `${APP_BASE_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      shipping_options: [
        {
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: shippingAmountCents, currency },
            display_name: isFallback ? "Standard shipping" : body.selectedRate.displayName,
            tax_behavior: "exclusive",
            ...(body.selectedRate.estDays != null && {
              delivery_estimate: {
                minimum: {
                  unit: "business_day" as const,
                  value: body.selectedRate.estDays,
                },
                maximum: {
                  unit: "business_day" as const,
                  value: body.selectedRate.estDays + 2,
                },
              },
            }),
            metadata: {
              objectId: isFallback ? "" : body.selectedRate.objectId,
              estDays: body.selectedRate.estDays != null ? String(body.selectedRate.estDays) : "",
            },
          },
        },
      ],
      customer_email: buyerEmail,
      automatic_tax: {
        enabled: true,
        liability: { type: "self" as const },
      },
      payment_intent_data: {
        transfer_data: {
          destination: sellerStripeAccountId,
          // Platform fee is retained by transferring only the seller portion.
          // Do not also set application_fee_amount with this manual transfer model.
          amount: sellerTransferAmount,
        },
        statement_descriptor_suffix: descriptorSuffix,
        // NOTE: on_behalf_of intentionally omitted —
        // deferred until Terms update
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
          tags: { source: "checkout_stock_reservation_session", route: "single_checkout" },
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
        return privateJson(
          { error: "Checkout state changed. Please try again." },
          { status: HTTP_STATUS.CONFLICT },
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
          tags: { source: "checkout_lock_ready", route: "single_checkout" },
          extra: {
            checkoutLockKeyHash: hashIdentifierForTelemetry(checkoutLockKeyValue),
            stripeSessionId: session.id,
          },
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
        return privateJson(
          { error: "Checkout state changed. Please try again." },
          { status: HTTP_STATUS.CONFLICT },
        );
      }
    } catch (lockErr) {
      Sentry.captureException(lockErr, { tags: { source: "checkout_lock_ready" } });
    }

    return privateJson({ clientSecret: session.client_secret, sessionId: session.id });
  } catch (err: unknown) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    logServerError(err, {
      source: "checkout_single_route",
      tags: { route: "/api/cart/checkout/single" },
      extra: {
        checkoutReservationId,
        reservedItemCount: checkoutReservationItemCount,
        checkoutLockAcquired,
      },
    });

    if (checkoutReservationId) {
      await restoreCheckoutStockReservationOnce({
        reservationId: checkoutReservationId,
        reason: "checkout_create_error",
        releaseLock: false,
      }).catch((restoreError) => {
        Sentry.captureException(restoreError, {
          level: "warning",
          tags: { source: "checkout_stock_restore_failed", route: "cart_checkout_single" },
          extra: { checkoutReservationId, reason: "checkout_create_error" },
        });
      });
    }

    if (checkoutLockAcquired) {
      await releaseCheckoutLock(checkoutLockKeyValue);
    }

    return privateJson({ error: "Server error creating checkout session" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
