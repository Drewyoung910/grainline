// src/app/api/cart/checkout/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { checkoutRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const { success, reset } = await safeRateLimit(checkoutRatelimit, userId);
    if (!success) {
      return rateLimitResponse(reset, "Too many checkout attempts.");
    }

    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const cart = await prisma.cart.findUnique({
      where: { userId: me.id },
      include: {
        items: {
          include: {
            listing: {
              include: {
                seller: true,
                photos: true,
              },
            },
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
    }

    // Enforce one seller per checkout
    const sellerId = cart.items[0].listing.sellerId;
    if (cart.items.some((i) => i.listing.sellerId !== sellerId)) {
      return NextResponse.json(
        { error: "Cart must contain items from one seller" },
        { status: 400 }
      );
    }

    // Block checkout if the seller is on vacation
    if (cart.items[0].listing.seller.vacationMode) {
      return NextResponse.json(
        { error: "One or more items in your cart are from a seller who is currently on vacation and not accepting new orders. Please remove these items to continue." },
        { status: 400 }
      );
    }

    const currency = (cart.items[0].listing.currency || "usd").toLowerCase();
    const destination = cart.items[0].listing.seller.stripeAccountId || null;

    // Build product line items
    const line_items = cart.items.map((i) => ({
      quantity: i.quantity,
      price_data: {
        currency,
        unit_amount: i.priceCents,
        product_data: {
          name: i.listing.title,
          images: i.listing.photos?.length ? [i.listing.photos[0]!.url] : undefined,
          metadata: { listingId: i.listing.id },
        },
      },
    }));

    // Platform fee on items subtotal (excludes shipping & tax)
    const itemsSubtotalCents = cart.items.reduce(
      (s, i) => s + i.priceCents * i.quantity,
      0
    );

    const success_url = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancel_url = `${process.env.NEXT_PUBLIC_APP_URL}/cart`;

    // Base Checkout config (Stripe Tax + address collection so tax/shipping get computed)
    const base: Record<string, unknown> = {
      mode: "payment",
      success_url,
      cancel_url,
      line_items,
      billing_address_collection: "auto",
      shipping_address_collection: { allowed_countries: ["US"] },
      automatic_tax: { enabled: true },
      // Track context for webhook/order creation
      metadata: { cartId: cart.id, buyerId: me.id, sellerId },
    };

    // Connect transfer + application fee (on items subtotal only)
    if (destination) {
      base.payment_intent_data = {
        transfer_data: { destination },
        application_fee_amount: Math.floor(itemsSubtotalCents * 0.05), // 5% platform fee
      };
    }

    /**
     * Try to fetch **calculated** shipping options from our quoting endpoint.
     * The quoting API (steps 1–4) can infer dims/weights from DB (listing + seller defaults),
     * aggregate them into one parcel, and return an array like:
     * [{ id, label, amountCents, taxBehavior?, service?, estDays? }, ...]
     */
    let shipping_options: Array<Record<string, unknown>> = [];
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/shipping/quote`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Keep payload minimal; server can look up everything needed by cartId/sellerId
          body: JSON.stringify({
            mode: "cart",
            cartId: cart.id,
            sellerId,
            currency,
          }),
        }
      );

      if (res.ok) {
        const data = await res.json();
        const rates: Array<{
          id?: string;
          label: string;
          amountCents: number;
          taxBehavior?: "exclusive" | "inclusive" | "unspecified";
        }> = Array.isArray(data?.rates) ? data.rates : [];

        shipping_options = rates.slice(0, 20).map((r) => ({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: Math.max(0, Math.floor(r.amountCents)), currency },
            display_name: r.label,
            tax_behavior: r.taxBehavior || "exclusive",
            // You can add delivery_estimate if your quote API returns ETA windows
          },
        }));
      }
    } catch (e) {
      console.warn("Shippo quote fetch failed; falling back to seller settings.", e);
    }

    // If no calculated rates came back, fall back to seller-configured flat/free/pickup
    if (!shipping_options.length) {
      const sellerProfile = await prisma.sellerProfile.findUnique({
        where: { id: sellerId },
        select: {
          shippingFlatRate: true, // dollars
          freeShippingOver: true, // dollars
          allowLocalPickup: true,
        },
      });

      const flatDollars = sellerProfile?.shippingFlatRate ?? null;
      const freeOverDollars = sellerProfile?.freeShippingOver ?? null;
      const allowPickup = !!sellerProfile?.allowLocalPickup;

      // Free if threshold hit
      if (
        freeOverDollars != null &&
        Number.isFinite(freeOverDollars) &&
        itemsSubtotalCents >= Math.round(freeOverDollars * 100)
      ) {
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency },
            display_name: "Free shipping",
            tax_behavior: "exclusive",
          },
        });
      }

      // Flat rate
      if (flatDollars != null && Number.isFinite(flatDollars) && flatDollars >= 0) {
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: Math.round(flatDollars * 100), currency },
            display_name: "Flat shipping",
            tax_behavior: "exclusive",
          },
        });
      }

      // Local pickup
      if (allowPickup) {
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency },
            display_name: "Local pickup (no shipping)",
            tax_behavior: "exclusive",
          },
        });
      }

      // Safety: at least one option
      if (!shipping_options.length) {
        shipping_options.push({
          shipping_rate_data: {
            type: "fixed_amount",
            fixed_amount: { amount: 0, currency },
            display_name: "Local pickup (no shipping)",
            tax_behavior: "exclusive",
          },
        });
      }
    }

    base.shipping_options = shipping_options;

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/cart/checkout error:", err);
    return NextResponse.json(
      { error: "Server error creating checkout session" },
      { status: 500 }
    );
  }
}

