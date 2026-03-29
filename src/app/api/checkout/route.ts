import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { listingId, quantity: qtyRaw } = await req.json();
    if (!listingId) return NextResponse.json({ error: "Missing listingId" }, { status: 400 });

    const quantity = Math.max(1, Math.min(99, Number(qtyRaw || 1)));
    const listing = await prisma.listing.findUnique({
      where: { id: String(listingId) },
      include: { seller: true, photos: true },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    const priceCents = listing.priceCents ?? 0;
    const currency = (listing.currency || "usd").toLowerCase();

    // If the seller has connected Stripe, send destination & fee
    const destination = (listing.seller as { stripeAccountId?: string | null })?.stripeAccountId || null;
    const platformFee = Math.floor(priceCents * quantity * 0.01); // 1% fee (tweak later)

    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${process.env.NEXT_PUBLIC_APP_URL}/listing/${listing.id}`;

    const base: Record<string, unknown> = {
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: [
        {
          quantity,
          price_data: {
            currency,
            unit_amount: priceCents,
            product_data: {
              name: listing.title,
              images: listing.photos?.length ? [listing.photos[0]?.url] : undefined,
              metadata: { listingId: listing.id },
            },
          },
        },
      ],
      // let the webhook know what to create after payment
      metadata: { listingId: listing.id, buyerId: me.id, quantity: String(quantity) },
    };

    if (destination) {
      base.payment_intent_data = {
        transfer_data: { destination },
        application_fee_amount: platformFee,
      };
    }

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error("checkout error:", e);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
