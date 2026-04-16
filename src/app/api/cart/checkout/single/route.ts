import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { isFallbackRate } from "@/types/checkout";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";

const CheckoutSingleSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(10).default(1),
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
    displayName: z.string().min(1).max(200),
    carrier: z.string().max(100),
    estDays: z.number().int().nullable(),
  }),
  giftNote: z.string().max(200).optional().nullable(),
  giftWrapping: z.boolean().optional().default(false),
  giftWrappingPriceCents: z.number().int().min(0).optional().default(0),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many checkout attempts.");

    const me = await ensureUserByClerkId(userId);

    let body;
    try {
      body = CheckoutSingleSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
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
            chargesEnabled: true,
            vacationMode: true,
          },
        },
      },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    if (listing.seller.userId === me.id) {
      return NextResponse.json({ error: "You cannot buy your own listing." }, { status: 400 });
    }

    if (listing.seller.vacationMode) {
      return NextResponse.json(
        { error: "This seller is currently on vacation and not accepting new orders." },
        { status: 400 },
      );
    }

    const currency = (listing.currency || "usd").toLowerCase();
    const sellerStripeAccountId = listing.seller.stripeAccountId || null;
    const sp = listing.seller;

    // Pre-flight: verify seller can accept payments
    if (!sellerStripeAccountId || !sp.chargesEnabled) {
      return NextResponse.json(
        { error: "This seller is not currently accepting orders. Please try again later." },
        { status: 400 },
      );
    }

    // Resolve shipping amount — fall back to SiteConfig if fallback rate selected
    const isFallback = isFallbackRate(body.selectedRate);
    let shippingAmountCents = body.selectedRate.amountCents;
    if (isFallback) {
      const siteConfig = await prisma.siteConfig.findUnique({
        where: { id: 1 },
        select: { fallbackShippingCents: true },
      });
      shippingAmountCents = siteConfig?.fallbackShippingCents ?? 1500;
    }

    const giftWrapCents = body.giftWrapping ? body.giftWrappingPriceCents : 0;
    const itemsSubtotalCents = listing.priceCents * body.quantity;

    // Platform fee is 5% of items subtotal (excludes shipping, gift wrap, tax)
    const platformFee = Math.round(itemsSubtotalCents * 0.05);

    // Seller receives items + shipping + gift wrap - platform fee.
    // Tax is excluded — platform retains tax (marketplace facilitator).
    const sellerTransferAmount =
      itemsSubtotalCents + shippingAmountCents + giftWrapCents - platformFee;

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
          unit_amount: listing.priceCents,
          product_data: {
            name: listing.title,
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
    const descriptorSuffix = (sp.displayName ?? "")
      .slice(0, 22)
      .toUpperCase()
      .replace(/[^A-Z0-9 ]/g, "")
      .trim();

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      // CRITICAL: "if_required" lets onComplete fire for card payments.
      // "always" (the default) redirects instead of firing onComplete.
      redirect_on_completion: "if_required",
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      mode: "payment",
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
          amount: sellerTransferAmount,
        },
        ...(descriptorSuffix.length > 0 && { statement_descriptor_suffix: descriptorSuffix }),
        // NOTE: on_behalf_of intentionally omitted —
        // deferred until Terms update
      },
      metadata: {
        listingId: body.listingId,
        quantity: String(body.quantity),
        priceCents: String(listing.priceCents),
        buyerId: me.id,
        taxRetainedAtCreation: "true",
        selectedRateObjectId: body.selectedRate.objectId,
        quotedToName: body.shippingAddress.name,
        quotedToLine1: body.shippingAddress.line1,
        quotedToLine2: body.shippingAddress.line2 ?? "",
        quotedToCity: body.shippingAddress.city,
        quotedToState: body.shippingAddress.state,
        quotedToPostalCode: body.shippingAddress.postalCode,
        quotedToCountry: "US",
        quotedToPhone: body.shippingAddress.phone ?? "",
        quotedShippingAmountCents: String(shippingAmountCents),
        giftNote: body.giftNote ?? "",
        giftWrapping: body.giftWrapping ? "true" : "false",
        giftWrappingPriceCents: body.giftWrapping ? String(giftWrapCents) : "",
      },
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err: unknown) {
    console.error("POST /api/cart/checkout/single error:", err);
    Sentry.captureException(err);
    const msg = err instanceof Error ? err.message : "Server error creating checkout session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
