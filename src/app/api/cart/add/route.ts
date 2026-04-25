import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const CartAddSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
  selectedVariantOptionIds: z.array(z.string()).max(30).optional(),
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
      parsed = CartAddSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const listingId = parsed.listingId;
    const quantity = parsed.quantity ?? 1;
    const selectedVariantOptionIds = parsed.selectedVariantOptionIds ?? [];

    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        seller: { include: { user: { select: { banned: true, deletedAt: true } } } },
        variantGroups: { include: { options: true } },
      },
    });
    if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

    if (listing.status !== "ACTIVE") {
      return NextResponse.json({ error: "This listing is not available." }, { status: 400 });
    }

    // prevent adding your own listing
    if (listing.seller.userId === me.id) {
      return NextResponse.json({ error: "You cannot add your own listing to cart." }, { status: 400 });
    }

    if (listing.seller.user.banned || listing.seller.user.deletedAt) {
      return NextResponse.json({ error: "This seller is not currently accepting orders." }, { status: 400 });
    }

    if (!listing.seller.chargesEnabled || !listing.seller.stripeAccountId) {
      return NextResponse.json({ error: "This seller is not currently accepting orders." }, { status: 400 });
    }

    // block adding items from a vacationing seller
    if (listing.seller.vacationMode) {
      return NextResponse.json({ error: "This seller is currently on vacation and not accepting new orders." }, { status: 400 });
    }

    // Block private/reserved listings
    if (listing.isPrivate && listing.reservedForUserId !== me.id) {
      return NextResponse.json({ error: "This listing is not available." }, { status: 400 });
    }

    // Cap made-to-order quantity at 1
    if (listing.listingType === "MADE_TO_ORDER" && quantity > 1) {
      return NextResponse.json({ error: "Made-to-order items can only be ordered one at a time." }, { status: 400 });
    }

    const variantResolution = resolveListingVariantSelection(
      listing.variantGroups,
      selectedVariantOptionIds,
    );
    if (!variantResolution.ok) {
      return NextResponse.json({ error: variantResolution.error }, { status: 400 });
    }

    const totalPriceCents = listing.priceCents + variantResolution.variantAdjustCents;
    if (totalPriceCents < 1) {
      return NextResponse.json({ error: "Variant selection results in an invalid price." }, { status: 400 });
    }

    const variantKey = variantResolution.variantKey;

    // ensure cart
    let cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) cart = await prisma.cart.create({ data: { userId: me.id } });

    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
      },
      select: { quantity: true },
    });
    const nextQuantity = listing.listingType === "MADE_TO_ORDER"
      ? 1
      : (existingItem?.quantity ?? 0) + quantity;
    if (nextQuantity > 99) {
      return NextResponse.json({ error: "Cart quantity cannot exceed 99." }, { status: 400 });
    }
    if (listing.listingType === "IN_STOCK") {
      const available = listing.stockQuantity ?? 0;
      if (available <= 0) {
        return NextResponse.json({ error: "This item is currently out of stock." }, { status: 400 });
      }
      if (nextQuantity > available) {
        return NextResponse.json({ error: `Only ${available} available.` }, { status: 400 });
      }
    }

    const item = await prisma.cartItem.upsert({
      where: {
        cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
      },
      update: listing.listingType === "MADE_TO_ORDER"
        ? { quantity: 1 } // MTO: always 1, don't accumulate
        : { quantity: { increment: quantity } },
      create: {
        cartId: cart.id,
        listingId,
        quantity,
        priceCents: totalPriceCents,
        selectedVariantOptionIds,
        variantKey,
      },
      include: { listing: true },
    });

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("POST /api/cart/add error:", err);
    return NextResponse.json({ error: "Server error adding to cart" }, { status: 500 });
  }
}
