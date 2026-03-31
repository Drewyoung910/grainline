import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);

    let body: Record<string, unknown> | null = null;
    try { body = await req.json(); } catch {}
    if (!body || !body.listingId) {
      return NextResponse.json({ error: "Missing listingId" }, { status: 400 });
    }

    const listingId = String(body.listingId);
    const quantity = Math.max(1, Math.min(99, Number(body.quantity ?? 1)));

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: { seller: true },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    // prevent adding your own listing
    if (listing.seller.userId === me.id) {
      return NextResponse.json({ error: "You cannot add your own listing to cart." }, { status: 400 });
    }

    // block adding items from a vacationing seller
    if (listing.seller.vacationMode) {
      return NextResponse.json({ error: "This seller is currently on vacation and not accepting new orders." }, { status: 400 });
    }

    // ensure cart
    let cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) cart = await prisma.cart.create({ data: { userId: me.id } });

    const item = await prisma.cartItem.upsert({
      where: { cartId_listingId: { cartId: cart.id, listingId } },
      update: { quantity: { increment: quantity } },
      create: {
        cartId: cart.id,
        listingId,
        quantity,
        priceCents: listing.priceCents, // snapshot
      },
      include: { listing: true },
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    console.error("POST /api/cart/add error:", err);
    return NextResponse.json({ error: "Server error adding to cart" }, { status: 500 });
  }
}





