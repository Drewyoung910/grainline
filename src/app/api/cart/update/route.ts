import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import * as Sentry from "@sentry/nextjs";
import { z } from "zod";
import { privateJson, privateResponse } from "@/lib/privateResponse";

const CartUpdateSchema = z.object({
  cartItemId: z.string().min(1).optional(),
  listingId: z.string().min(1).optional(),
  quantity: z.number().int().min(0).max(99),
});
const CART_UPDATE_BODY_MAX_BYTES = 16 * 1024;
const MAX_CART_TOTAL_QUANTITY = 200;

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);
    const { success, reset } = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many cart updates."));

    let parsed;
    try {
      parsed = CartUpdateSchema.parse(await readBoundedJson(req, CART_UPDATE_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson({ error: "Request body too large" }, { status: 413 });
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: 400 });
      }
      if (e instanceof z.ZodError) {
        return privateJson({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      throw e;
    }
    const { cartItemId, listingId, quantity } = parsed;
    if (!cartItemId && !listingId) {
      return privateJson({ error: "cartItemId or listingId required" }, { status: 400 });
    }

    const cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) return privateJson({ error: "Cart not found" }, { status: 404 });

    // Find the cart item — prefer cartItemId, fall back to listingId
    const item = cartItemId
      ? await prisma.cartItem.findFirst({ where: { id: cartItemId, cartId: cart.id } })
      : await prisma.cartItem.findFirst({ where: { cartId: cart.id, listingId: listingId! } });
    if (!item) return privateJson({ error: "Item not in cart" }, { status: 404 });

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
              stripeAccountId: true,
              vacationMode: true,
              acceptingNewOrders: true,
              stripeAccountVersion: true,
              user: { select: { banned: true, deletedAt: true } },
            },
          },
        },
      });
      if (!listing || listing.status !== "ACTIVE") {
        return privateJson({ error: "This item is no longer available." }, { status: 400 });
      }
      if (listing.isPrivate && listing.reservedForUserId !== me.id) {
        return privateJson({ error: "This item is no longer available." }, { status: 400 });
      }
      if (
        !listing.seller.chargesEnabled ||
        !listing.seller.stripeAccountId ||
        listing.seller.user.banned ||
        listing.seller.user.deletedAt
      ) {
        return privateJson({ error: "This seller is not currently accepting orders." }, { status: 400 });
      }
      const sellerBlockReason = sellerOrderBlockReason(listing.seller);
      if (sellerBlockReason) {
        return privateJson({ error: sellerOrderBlockMessage(sellerBlockReason) }, { status: 400 });
      }
      if (listing?.listingType === "MADE_TO_ORDER" && quantity > 1) {
        return privateJson(
          { error: "Made-to-order items can only be ordered one at a time." },
          { status: 400 },
        );
      }
      if (listing.listingType === "IN_STOCK" && quantity > (listing.stockQuantity ?? 0)) {
        return privateJson(
          { error: `Only ${listing.stockQuantity ?? 0} available.` },
          { status: 400 },
        );
      }
      const cartStats = await prisma.cartItem.aggregate({
        where: { cartId: cart.id },
        _sum: { quantity: true },
      });
      const projectedTotalQuantity = (cartStats._sum.quantity ?? 0) - item.quantity + quantity;
      if (projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY) {
        return privateJson(
          { error: "Your cart can hold up to 200 total items." },
          { status: 400 },
        );
      }
      const variantResolution = resolveListingVariantSelection(listing.variantGroups, item.selectedVariantOptionIds ?? []);
      if (!variantResolution.ok) {
        return privateJson({ error: variantResolution.error }, { status: 400 });
      }
      livePriceCents = listing.priceCents + variantResolution.variantAdjustCents;
      if (livePriceCents < 1) {
        return privateJson({ error: "Variant selection results in an invalid price." }, { status: 400 });
      }
      livePriceVersion = listing.priceVersion;
    }

    if (quantity === 0) {
      await prisma.cartItem.deleteMany({ where: { id: item.id, cartId: item.cartId } });
    } else {
      const updated = await prisma.cartItem.updateMany({
        where: { id: item.id, cartId: item.cartId },
        data: {
          quantity,
          priceCents: livePriceCents,
          priceVersion: livePriceVersion,
        },
      });
      if (updated.count === 0) {
        return privateJson({ error: "Cart item changed. Refresh and try again." }, { status: 409 });
      }
    }

    return privateJson({ ok: true });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("POST /api/cart/update error:", err);
    Sentry.captureException(err, { tags: { source: "cart_update_route", route: "/api/cart/update" } });
    return privateJson({ error: "Server error updating cart" }, { status: 500 });
  }
}
