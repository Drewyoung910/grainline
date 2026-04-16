// src/app/api/cart/checkout-seller/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { isFallbackRate } from "@/types/checkout";
import { safeRateLimit, checkoutRatelimit } from "@/lib/ratelimit";
import { z } from "zod";

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
      body = CheckoutSellerSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const sellerId = body.sellerId;

    const giftNote: string = body.giftNote ?? "";
    const giftWrapping: boolean = body.giftWrapping === true;
    const giftWrappingPriceCents: number =
      giftWrapping && Number.isFinite(body.giftWrappingPriceCents) && (body.giftWrappingPriceCents ?? 0) > 0
        ? Math.round(body.giftWrappingPriceCents!)
        : 0;

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
          include: { listing: { include: { seller: true, photos: true } } },
        },
      },
    });
    if (!cart) return NextResponse.json({ error: "Cart is empty" }, { status: 400 });

    const sellerItems = cart.items.filter((it) => it.listing.sellerId === sellerId);
    if (sellerItems.length === 0) {
      return NextResponse.json({ error: "No items for this seller" }, { status: 400 });
    }

    const currency = (sellerItems[0].listing.currency || "usd").toLowerCase();
    const destination = sellerItems[0].listing.seller.stripeAccountId || null;
    const sellerChargesEnabled = sellerItems[0].listing.seller.chargesEnabled ?? false;

    // Pre-flight: verify seller can accept payments
    if (!destination || !sellerChargesEnabled) {
      return NextResponse.json({ error: "This seller is not currently accepting orders. Please try again later." }, { status: 400 });
    }

    // Stripe line items
    const line_items: {
      quantity: number;
      price_data: { currency: string; unit_amount: number; product_data: { name: string; images?: string[]; metadata?: Record<string, string>; tax_code?: string } };
    }[] = sellerItems.map((i) => ({
      quantity: i.quantity,
      price_data: {
        currency,
        unit_amount: i.priceCents,
        product_data: {
          name: i.listing.title,
          images: i.listing.photos?.length ? [i.listing.photos[0]!.url] : undefined,
          metadata: { listingId: i.listing.id },
          tax_code: "txcd_99999999", // General - Tangible Personal Property
        },
      },
    }));

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

    const itemsSubtotalCents = sellerItems.reduce(
      (sum, it) => sum + it.priceCents * it.quantity,
      0
    );

    // Resolve shipping amount — use fallback from SiteConfig if rate is the fallback placeholder
    let shippingAmountCents = body.selectedRate.amountCents;
    if (isFallbackRate(body.selectedRate)) {
      const siteConfig = await prisma.siteConfig.findUnique({
        where: { id: 1 },
        select: { fallbackShippingCents: true },
      });
      shippingAmountCents = siteConfig?.fallbackShippingCents ?? 1500;
    }

    const giftWrapCents = body.giftWrapping ? body.giftWrappingPriceCents : 0;
    const platformFee = Math.round(itemsSubtotalCents * 0.05);
    const sellerTransferAmount = itemsSubtotalCents + shippingAmountCents + giftWrapCents - platformFee;

    const return_url = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;

    const csDescriptor = (sellerItems[0].listing.seller.displayName ?? "")
      .slice(0, 22).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();

    const session = await stripe.checkout.sessions.create({
      ui_mode: "embedded",
      mode: "payment",
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
          amount: sellerTransferAmount,
        },
        ...(csDescriptor.length > 0 && { statement_descriptor_suffix: csDescriptor }),
      },
      metadata: {
        cartId: cart.id,
        buyerId: me.id,
        sellerId,
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
        giftNote: giftNote ?? "",
        giftWrapping: giftWrapping ? "true" : "false",
        giftWrappingPriceCents: giftWrapping && giftWrappingPriceCents > 0 ? String(giftWrappingPriceCents) : "",
      },
    });

    return NextResponse.json({ clientSecret: session.client_secret });
  } catch (err: unknown) {
    console.error("POST /api/cart/checkout-seller error:", err);
    const msg = err instanceof Error ? err.message : "Server error creating checkout session";
    return NextResponse.json(
      { error: msg },
      { status: 500 }
    );
  }
}
