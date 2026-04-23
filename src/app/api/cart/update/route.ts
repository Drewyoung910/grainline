import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { z } from "zod";

const CartUpdateSchema = z.object({
  cartItemId: z.string().min(1).optional(),
  listingId: z.string().min(1).optional(),
  quantity: z.number().int().min(0).max(99),
});

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);

    let parsed;
    try {
      parsed = CartUpdateSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const { cartItemId, listingId, quantity } = parsed;
    if (!cartItemId && !listingId) {
      return NextResponse.json({ error: "cartItemId or listingId required" }, { status: 400 });
    }

    const cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

    // Find the cart item — prefer cartItemId, fall back to listingId
    const item = cartItemId
      ? await prisma.cartItem.findFirst({ where: { id: cartItemId, cartId: cart.id } })
      : await prisma.cartItem.findFirst({ where: { cartId: cart.id, listingId: listingId! } });
    if (!item) return NextResponse.json({ error: "Item not in cart" }, { status: 404 });

    if (quantity > 0) {
      const listing = await prisma.listing.findUnique({
        where: { id: item.listingId },
        select: { listingType: true, stockQuantity: true },
      });
      if (listing?.listingType === "IN_STOCK" && listing.stockQuantity != null && quantity > listing.stockQuantity) {
        return NextResponse.json({ error: `Only ${listing.stockQuantity} available.` }, { status: 400 });
      }
    }

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/cart/update error:", err);
    return NextResponse.json({ error: "Server error updating cart" }, { status: 500 });
  }
}
