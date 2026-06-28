import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection, validateVariantUnitPriceCents } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { z } from "zod";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { logServerError } from "@/lib/serverErrorLogger";

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
    if (!userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const me = await ensureUserByClerkId(userId);
    const { success, reset } = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many cart updates."));

    let parsed;
    try {
      parsed = CartUpdateSchema.parse(await readBoundedJson(req, CART_UPDATE_BODY_MAX_BYTES));
    } catch (e) {
      if (isRequestBodyTooLargeError(e)) {
        return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
      }
      if (isInvalidJsonBodyError(e)) {
        return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (e instanceof z.ZodError) {
        return privateJson({ error: "Invalid input", details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      throw e;
    }
    const { cartItemId, listingId, quantity } = parsed;
    if (!cartItemId && !listingId) {
      return privateJson({ error: "cartItemId or listingId required" }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const cart = await prisma.cart.findUnique({ where: { userId: me.id } });
    if (!cart) return privateJson({ error: "Cart not found" }, { status: HTTP_STATUS.NOT_FOUND });

    // Find the cart item — prefer cartItemId. Listing-only updates are a
    // legacy fallback and are ambiguous once variants create multiple rows.
    let item = cartItemId
      ? await prisma.cartItem.findFirst({ where: { id: cartItemId, cartId: cart.id } })
      : null;
    if (!item && !cartItemId && listingId) {
      const matchingItems = await prisma.cartItem.findMany({
        where: { cartId: cart.id, listingId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 2,
      });
      if (matchingItems.length > 1) {
        return privateJson(
          { error: "Use cartItemId to update variant cart lines." },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      item = matchingItems[0] ?? null;
    }
    if (!item) return privateJson({ error: "Item not in cart" }, { status: HTTP_STATUS.NOT_FOUND });

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
        return privateJson({ error: "This item is no longer available." }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (listing.isPrivate && listing.reservedForUserId !== me.id) {
        return privateJson({ error: "This item is no longer available." }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (
        !listing.seller.chargesEnabled ||
        !listing.seller.stripeAccountId ||
        listing.seller.user.banned ||
        listing.seller.user.deletedAt
      ) {
        return privateJson({ error: "This seller is not currently accepting orders." }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      const sellerBlockReason = sellerOrderBlockReason(listing.seller);
      if (sellerBlockReason) {
        return privateJson({ error: sellerOrderBlockMessage(sellerBlockReason) }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      if (listing?.listingType === "MADE_TO_ORDER" && quantity > 1) {
        return privateJson(
          { error: "Made-to-order items can only be ordered one at a time." },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      if (listing.listingType === "IN_STOCK" && quantity > (listing.stockQuantity ?? 0)) {
        return privateJson(
          { error: `Only ${listing.stockQuantity ?? 0} available.` },
          { status: HTTP_STATUS.BAD_REQUEST },
        );
      }
      const variantResolution = resolveListingVariantSelection(listing.variantGroups, item.selectedVariantOptionIds ?? []);
      if (!variantResolution.ok) {
        return privateJson({ error: variantResolution.error }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      livePriceCents = listing.priceCents + variantResolution.variantAdjustCents;
      const unitPriceError = validateVariantUnitPriceCents(livePriceCents);
      if (unitPriceError) {
        return privateJson({ error: unitPriceError }, { status: HTTP_STATUS.BAD_REQUEST });
      }
      livePriceVersion = listing.priceVersion;
    }

    const mutation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cart.id} FOR UPDATE`;

      const lockedItem = await tx.cartItem.findFirst({
        where: { id: item.id, cartId: item.cartId },
        select: { id: true, cartId: true, quantity: true },
      });

      if (!lockedItem) {
        return {
          ok: false as const,
          error: "Cart item changed. Refresh and try again.",
          status: HTTP_STATUS.CONFLICT,
        };
      }

      if (quantity === 0) {
        await tx.cartItem.deleteMany({ where: { id: lockedItem.id, cartId: lockedItem.cartId } });
        return { ok: true as const };
      }

      const cartStats = await tx.cartItem.aggregate({
        where: { cartId: cart.id },
        _sum: { quantity: true },
      });
      const projectedTotalQuantity = (cartStats._sum.quantity ?? 0) - lockedItem.quantity + quantity;
      if (projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY) {
        return {
          ok: false as const,
          error: "Your cart can hold up to 200 total items.",
          status: HTTP_STATUS.BAD_REQUEST,
        };
      }

      const updated = await tx.cartItem.updateMany({
        where: { id: lockedItem.id, cartId: lockedItem.cartId },
        data: {
          quantity,
          priceCents: livePriceCents,
          priceVersion: livePriceVersion,
        },
      });
      if (updated.count === 0) {
        return {
          ok: false as const,
          error: "Cart item changed. Refresh and try again.",
          status: HTTP_STATUS.CONFLICT,
        };
      }

      return { ok: true as const };
    });

    if (!mutation.ok) {
      return privateJson({ error: mutation.error }, { status: mutation.status });
    }

    return privateJson({ ok: true });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    logServerError(err, {
      source: "cart_update_route",
      tags: { route: "/api/cart/update" },
    });
    return privateJson({ error: "Server error updating cart" }, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR });
  }
}
