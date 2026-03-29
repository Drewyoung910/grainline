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
    const listingId = String(body?.listingId || "");
    const qtyRaw = body?.quantity;
    if (!listingId || qtyRaw == null) {
      return NextResponse.json({ error: "Missing listingId/quantity" }, { status: 400 });
    }
    const quantity = Math.max(0, Math.min(99, Number(qtyRaw)));

    const cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

    const key = { cartId_listingId: { cartId: cart.id, listingId } };
    const exists = await prisma.cartItem.findUnique({ where: key });
    if (!exists) return NextResponse.json({ error: "Item not in cart" }, { status: 404 });

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: key });
    } else {
      await prisma.cartItem.update({ where: key, data: { quantity } });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/cart/update error:", err);
    return NextResponse.json({ error: "Server error updating cart" }, { status: 500 });
  }
}





