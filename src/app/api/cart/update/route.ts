import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
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
    const { success, reset } = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!success) return rateLimitResponse(reset, "Too many cart updates.");

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

    let livePriceCents = item.priceCents;
    let livePriceVersion = item.priceVersion;

    if (quantity > 0) {
      const listing = await prisma.listing.findUnique({
        where: { id: item.listingId },
        select: {
          listingType: true,
          priceCents: true,
          priceVersion: true,
          stockQuantity: true,
          status: true,
          isPrivate: true,
          reservedForUserId: true,
          variantGroups: { include: { options: true } },
          seller: {
            select: {
              chargesEnabled: true,
              vacationMode: true,
              user: { select: { banned: true, deletedAt: true } },
            },
          },
        },
      });
      if (!listing || listing.status !== "ACTIVE") {
        return NextResponse.json({ error: "This item is no longer available." }, { status: 400 });
      }
      if (listing.isPrivate && listing.reservedForUserId !== me.id) {
        return NextResponse.json({ error: "This item is no longer available." }, { status: 400 });
      }
      if (
        !listing.seller.chargesEnabled ||
        listing.seller.vacationMode ||
        listing.seller.user.banned ||
        listing.seller.user.deletedAt
      ) {
        return NextResponse.json({ error: "This seller is not currently accepting orders." }, { status: 400 });
      }
      if (listing?.listingType === "MADE_TO_ORDER" && quantity > 1) {
        return NextResponse.json(
          { error: "Made-to-order items can only be ordered one at a time." },
          { status: 400 },
        );
      }
      const variantResolution = resolveListingVariantSelection(listing.variantGroups, item.selectedVariantOptionIds ?? []);
      if (!variantResolution.ok) {
        return NextResponse.json({ error: variantResolution.error }, { status: 400 });
      }
      livePriceCents = listing.priceCents + variantResolution.variantAdjustCents;
      livePriceVersion = listing.priceVersion;
    }

    if (quantity === 0) {
      await prisma.cartItem.delete({ where: { id: item.id } });
    } else {
      await prisma.cartItem.update({
        where: { id: item.id },
        data: {
          quantity,
          priceCents: livePriceCents,
          priceVersion: livePriceVersion,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("POST /api/cart/update error:", err);
    return NextResponse.json({ error: "Server error updating cart" }, { status: 500 });
  }
}
