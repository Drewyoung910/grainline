import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { sellerOrderBlockMessage, sellerOrderBlockReason } from "@/lib/sellerOrderState";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import * as Sentry from "@sentry/nextjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { logServerError } from "@/lib/serverErrorLogger";
import { HTTP_STATUS } from "@/lib/httpStatus";

const CartAddSchema = z.object({
  listingId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).optional(),
  selectedVariantOptionIds: z.array(z.string()).max(30).optional(),
});
const CART_ADD_BODY_MAX_BYTES = 16 * 1024;
const MAX_CART_DISTINCT_ITEMS = 50;
const MAX_CART_TOTAL_QUANTITY = 200;

export const runtime = "nodejs";

function isUniqueConstraintError(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

class CartAddError extends Error {
  status: number;

  constructor(message: string, status = HTTP_STATUS.BAD_REQUEST) {
    super(message);
    this.name = "CartAddError";
    this.status = status;
  }
}

// Prisma codes that indicate a transient DB-side problem (connection pool
// exhaustion, network blip, server-closed-connection). Worth one retry
// rather than surfacing a 500 to the buyer.
function isTransientPrismaError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return err.code === "P2024" || err.code === "P1001" || err.code === "P1008" || err.code === "P1017";
  }
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (err instanceof Prisma.PrismaClientRustPanicError) return false;
  return false;
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return privateJson({ error: "Sign in required" }, { status: HTTP_STATUS.UNAUTHORIZED });

    const me = await ensureUserByClerkId(userId);
    const { success, reset } = await safeRateLimit(cartMutationRatelimit, me.id);
    if (!success) return privateResponse(rateLimitResponse(reset, "Too many cart updates."));

    let parsed;
    try {
      parsed = CartAddSchema.parse(await readBoundedJson(req, CART_ADD_BODY_MAX_BYTES));
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
    if (!listing) return privateJson({ error: "Listing not found" }, { status: HTTP_STATUS.NOT_FOUND });

    if (listing.status !== "ACTIVE") {
      return privateJson({ error: "This listing is not available." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    // prevent adding your own listing
    if (listing.seller.userId === me.id) {
      return privateJson({ error: "You cannot add your own listing to cart." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    if (!listing.seller.chargesEnabled || !listing.seller.stripeAccountId) {
      return privateJson({ error: "This seller is not currently accepting orders." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const sellerBlockReason = sellerOrderBlockReason(listing.seller);
    if (sellerBlockReason) {
      return privateJson({ error: sellerOrderBlockMessage(sellerBlockReason) }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    // Block private/reserved listings
    if (listing.isPrivate && listing.reservedForUserId !== me.id) {
      return privateJson({ error: "This listing is not available." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    // Cap made-to-order quantity at 1
    if (listing.listingType === "MADE_TO_ORDER" && quantity > 1) {
      return privateJson({ error: "Made-to-order items can only be ordered one at a time." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const variantResolution = resolveListingVariantSelection(
      listing.variantGroups,
      selectedVariantOptionIds,
    );
    if (!variantResolution.ok) {
      return privateJson({ error: variantResolution.error }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const totalPriceCents = listing.priceCents + variantResolution.variantAdjustCents;
    if (totalPriceCents < 1) {
      return privateJson({ error: "Variant selection results in an invalid price." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    const variantKey = variantResolution.variantKey;
    const listingForCart = listing;

    const cart = await prisma.cart.upsert({
      where: { userId: me.id },
      create: { userId: me.id },
      update: {},
    });

    // Idempotent add: lock this buyer's cart row, re-read cap state inside the
    // transaction, then create or increment. The row lock serializes concurrent
    // adds for one cart so distinct-item and total-quantity caps are not only
    // best-effort prechecks.
    async function addOrIncrement() {
      return prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Cart" WHERE id = ${cart.id} FOR UPDATE`;

        const existingCartItem = await tx.cartItem.findUnique({
          where: {
            cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
          },
          select: { quantity: true },
        });
        const cartStats = await tx.cartItem.aggregate({
          where: { cartId: cart.id },
          _count: { id: true },
          _sum: { quantity: true },
        });

        const projectedItemQuantity = listingForCart.listingType === "MADE_TO_ORDER"
          ? 1
          : (existingCartItem?.quantity ?? 0) + quantity;
        if (projectedItemQuantity > 99) {
          throw new CartAddError("Cart quantity cannot exceed 99.");
        }
        if (listingForCart.listingType === "IN_STOCK" && projectedItemQuantity > (listingForCart.stockQuantity ?? 0)) {
          throw new CartAddError(`Only ${listingForCart.stockQuantity ?? 0} available.`);
        }
        const projectedDistinctItems = cartStats._count.id + (existingCartItem ? 0 : 1);
        if (projectedDistinctItems > MAX_CART_DISTINCT_ITEMS) {
          throw new CartAddError("Your cart can hold up to 50 different items.");
        }
        const projectedTotalQuantity =
          (cartStats._sum.quantity ?? 0) - (existingCartItem?.quantity ?? 0) + projectedItemQuantity;
        if (projectedTotalQuantity > MAX_CART_TOTAL_QUANTITY) {
          throw new CartAddError("Your cart can hold up to 200 total items.");
        }

        let item: Awaited<ReturnType<typeof tx.cartItem.create>> | null = null;
        const createQuantity = listingForCart.listingType === "MADE_TO_ORDER" ? 1 : quantity;
        try {
          item = await tx.cartItem.create({
            data: {
              cartId: cart.id,
              listingId,
              quantity: createQuantity,
              priceCents: totalPriceCents,
              priceVersion: listingForCart.priceVersion,
              selectedVariantOptionIds,
              variantKey,
            },
            include: { listing: true },
          });
        } catch (err) {
          if (!isUniqueConstraintError(err)) throw err;
        }
        if (item) return item;

        if (listingForCart.listingType === "MADE_TO_ORDER") {
          await tx.cartItem.updateMany({
            where: {
              cartId: cart.id,
              listingId,
              variantKey,
            },
            data: {
              quantity: 1,
              priceCents: totalPriceCents,
              priceVersion: listingForCart.priceVersion,
              selectedVariantOptionIds,
            },
          });
        } else {
          const updated = await tx.cartItem.updateMany({
            where: {
              cartId: cart.id,
              listingId,
              variantKey,
              quantity: { lte: 99 - quantity },
            },
            data: {
              quantity: { increment: quantity },
              priceCents: totalPriceCents,
              priceVersion: listingForCart.priceVersion,
              selectedVariantOptionIds,
            },
          });
          if (updated.count === 0) {
            throw new CartAddError("Cart quantity cannot exceed 99.");
          }
        }

        return tx.cartItem.findUnique({
          where: {
            cartId_listingId_variantKey: { cartId: cart.id, listingId, variantKey },
          },
          include: { listing: true },
        });
      });
    }

    let item;
    try {
      item = await addOrIncrement();
    } catch (err) {
      if (err instanceof CartAddError) {
        return privateJson({ error: err.message }, { status: err.status });
      }
      if (isTransientPrismaError(err)) {
        Sentry.captureMessage("Cart add: transient Prisma error, retrying once", {
          level: "warning",
          tags: { source: "cart_add_route", listingId, variantKey: variantKey || "(none)" },
          extra: { errCode: err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null },
        });
        try {
          item = await addOrIncrement();
        } catch (retryErr) {
          if (retryErr instanceof CartAddError) {
            return privateJson({ error: retryErr.message }, { status: retryErr.status });
          }
          throw retryErr;
        }
      } else {
        throw err;
      }
    }

    if (!item) {
      return privateJson({ error: "Cart quantity cannot exceed 99." }, { status: HTTP_STATUS.BAD_REQUEST });
    }

    return privateJson({ ok: true, item });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return privateJson({ error: err.message, code: err.code }, { status: err.status });
    }
    const errCode = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : null;
    logServerError(err, {
      source: "cart_add_route",
      tags: { route: "/api/cart/add" },
      extra: { prismaErrorCode: errCode ?? "(none)" },
    });
    // The previous generic 500 left buyers staring at "Server error adding to
    // cart" with no path forward. Surface a slightly more useful retry hint
    // so the user knows it wasn't a duplicate-add or validation problem.
    return privateJson(
      { error: "We couldn't add this to your cart. Please try again in a moment." },
      { status: HTTP_STATUS.INTERNAL_SERVER_ERROR },
    );
  }
}
