import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";

const CartAddSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
  selectedVariantOptionIds: z.array(z.string()).max(30).optional(),
});

export const runtime = "nodejs";

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

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

    if (!listing.seller.chargesEnabled || !listing.seller.stripeAccountId) {
      return NextResponse.json({ error: "This seller is not currently accepting orders." }, { status: 400 });
    }

    const sellerBlockReason = sellerOrderBlockReason(listing.seller);
    if (sellerBlockReason) {
      return NextResponse.json({ error: sellerOrderBlockMessage(sellerBlockReason) }, { status: 400 });
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

    const cart = await prisma.cart.upsert({
      where: { userId: me.id },
      create: { userId: me.id },
      update: {},
    });

    let item;
    if (listing.listingType === "MADE_TO_ORDER") {
      item = await prisma.cartItem.upsert({
        where: {
          cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
        },
        update: { quantity: 1, priceCents: totalPriceCents, priceVersion: listing.priceVersion },
        create: {
          cartId: cart.id,
          listingId,
          quantity: 1,
          priceCents: totalPriceCents,
          priceVersion: listing.priceVersion,
          selectedVariantOptionIds,
          variantKey,
        },
        include: { listing: true },
      });
    } else {
      try {
        item = await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            listingId,
            quantity,
            priceCents: totalPriceCents,
            priceVersion: listing.priceVersion,
            selectedVariantOptionIds,
            variantKey,
          },
          include: { listing: true },
        });
      } catch (err) {
        if (!isUniqueConstraintError(err)) throw err;
      }

      if (!item) {
        const updated = await prisma.cartItem.updateMany({
          where: {
            cartId: cart.id,
            listingId,
            variantKey,
            quantity: { lte: 99 - quantity },
          },
          data: {
            quantity: { increment: quantity },
            priceCents: totalPriceCents,
            priceVersion: listing.priceVersion,
            selectedVariantOptionIds,
          },
        });
        if (updated.count === 0) {
          return NextResponse.json({ error: "Cart quantity cannot exceed 99." }, { status: 400 });
        }
        item = await prisma.cartItem.findUnique({
          where: {
            cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
          },
          include: { listing: true },
        });
        if (!item) throw new Error("CART_ITEM_MISSING_AFTER_UPDATE");
      }
    }

    return NextResponse.json({ ok: true, item });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("POST /api/cart/add error:", err);
    Sentry.captureException(err, { tags: { source: "cart_add_route", route: "/api/cart/add" } });
    return NextResponse.json({ error: "Server error adding to cart" }, { status: 500 });
  }
}
