import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
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
        seller: true,
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

    // Validate variant selections — if listing has variants, buyer must select one per group
    if (listing.variantGroups.length > 0) {
      const allGroupIds = new Set(listing.variantGroups.map((g) => g.id));
      const selectedGroups = new Set<string>();
      for (const optId of selectedVariantOptionIds) {
        for (const g of listing.variantGroups) {
          const opt = g.options.find((o) => o.id === optId);
          if (opt) {
            if (!opt.inStock) {
              return NextResponse.json({ error: `Option "${opt.label}" is out of stock.` }, { status: 400 });
            }
            selectedGroups.add(g.id);
          }
        }
      }
      if (selectedGroups.size !== allGroupIds.size) {
        return NextResponse.json({ error: "Please select one option from each variant group." }, { status: 400 });
      }
    }

    // Calculate price with variant adjustments
    let variantAdjustCents = 0;
    for (const optId of selectedVariantOptionIds) {
      for (const g of listing.variantGroups) {
        const opt = g.options.find((o) => o.id === optId);
        if (opt) variantAdjustCents += opt.priceAdjustCents;
      }
    }
    const totalPriceCents = listing.priceCents + variantAdjustCents;
    if (totalPriceCents < 1) {
      return NextResponse.json({ error: "Variant selection results in an invalid price." }, { status: 400 });
    }

    // Variant key for unique constraint — sorted option IDs
    const variantKey = selectedVariantOptionIds.length > 0
      ? [...selectedVariantOptionIds].sort().join(",")
      : "";

    // ensure cart
    let cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) cart = await prisma.cart.create({ data: { userId: me.id } });

    const item = await prisma.cartItem.upsert({
      where: {
        cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
      },
      update: { quantity: { increment: quantity } },
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
    console.error("POST /api/cart/add error:", err);
    return NextResponse.json({ error: "Server error adding to cart" }, { status: 500 });
  }
}
