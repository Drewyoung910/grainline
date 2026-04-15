import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { z } from "zod";

const CheckoutSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
});

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

    let parsed;
    try {
      parsed = CheckoutSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { listingId, quantity: qtyRaw } = parsed;
    const quantity = Math.max(1, Math.min(99, qtyRaw ?? 1));
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { seller: true, photos: true },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    if (listing.status !== "ACTIVE") return NextResponse.json({ error: "Listing not available" }, { status: 400 });
    if (listing.isPrivate && listing.reservedForUserId !== me.id) return NextResponse.json({ error: "Listing not available" }, { status: 400 });
    if (listing.seller.userId === me.id) return NextResponse.json({ error: "Cannot purchase your own listing" }, { status: 400 });

    const priceCents = listing.priceCents ?? 0;
    const currency = (listing.currency || "usd").toLowerCase();

    // Pre-flight: verify seller can accept payments
    const destination = (listing.seller as { stripeAccountId?: string | null; chargesEnabled?: boolean })?.stripeAccountId || null;
    const sellerChargesEnabled = (listing.seller as { chargesEnabled?: boolean })?.chargesEnabled ?? false;
    if (!destination || !sellerChargesEnabled) {
      return NextResponse.json({ error: "This seller is not currently accepting orders. Please try again later." }, { status: 400 });
    }

    const platformFee = Math.floor(priceCents * quantity * 0.05); // 5% platform fee (items only — no shipping on this route)

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
              tax_code: "txcd_99999999", // General - Tangible Personal Property
            },
          },
        },
      ],
      // let the webhook know what to create after payment
      metadata: { listingId: listing.id, buyerId: me.id, quantity: String(quantity), taxRetainedAtCreation: "true" },
      automatic_tax: { enabled: true, liability: { type: "self" } },
    };

    const sellerTransfer = (priceCents * quantity) - platformFee; // items minus fee — tax excluded
    const descriptorSuffix = ((listing.seller as { displayName?: string })?.displayName ?? "")
      .slice(0, 22).toUpperCase().replace(/[^A-Z0-9 ]/g, "").trim();
    base.payment_intent_data = {
      transfer_data: { destination, amount: sellerTransfer },
      application_fee_amount: platformFee,
      ...(descriptorSuffix.length > 0 && { statement_descriptor_suffix: descriptorSuffix }),
    };

    const session = await stripe.checkout.sessions.create(base);
    return NextResponse.json({ url: session.url });
  } catch (e: unknown) {
    console.error("checkout error:", e);
    const msg = e instanceof Error ? e.message : "Failed to create session";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
