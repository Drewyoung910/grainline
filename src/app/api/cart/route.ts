// src/app/api/cart/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId, isAccountAccessError } from "@/lib/ensureUser";
import { resolveListingVariantSelection } from "@/lib/listingVariants";
import { cartItemExceedsLiveStock } from "@/lib/stockMutationState";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);

    const cart = await prisma.cart.findUnique({
      where: { userId: me.id },
      include: {
        items: {
          include: {
            listing: {
              include: {
                photos: { take: 1, orderBy: { sortOrder: "asc" } },
                seller: {
                  select: {
                    id: true,
                    displayName: true,
                    vacationMode: true,
                    chargesEnabled: true,
                    freeShippingOverCents: true,
                    shippingFlatRateCents: true,
                    allowLocalPickup: true,
                    offersGiftWrapping: true,
                    giftWrappingPriceCents: true,
                    user: {
                      select: {
                        banned: true,
                        deletedAt: true,
                      },
                    },
                  },
                },
                variantGroups: { include: { options: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    const items = (cart?.items ?? []).map((ci) => {
      const seller = ci.listing.seller as {
        displayName?: string | null;
        freeShippingOverCents?: number | null;
        shippingFlatRateCents?: number | null;
        allowLocalPickup?: boolean | null;
        offersGiftWrapping?: boolean | null;
        giftWrappingPriceCents?: number | null;
        chargesEnabled?: boolean | null;
        vacationMode?: boolean | null;
        user?: { banned?: boolean | null; deletedAt?: Date | string | null } | null;
      };
      const freeOverCents = seller?.freeShippingOverCents ?? null;
      const shippingFlatRateCents = seller?.shippingFlatRateCents ?? null;
      // Resolve variant option labels
      const variantLabels: string[] = [];
      if (ci.selectedVariantOptionIds?.length) {
        for (const optId of ci.selectedVariantOptionIds) {
          for (const g of ci.listing.variantGroups ?? []) {
            const opt = g.options.find((o: { id: string }) => o.id === optId);
            if (opt) variantLabels.push(`${g.name}: ${(opt as { label: string }).label}`);
          }
        }
      }
      const variantResolution = resolveListingVariantSelection(
        ci.listing.variantGroups,
        ci.selectedVariantOptionIds ?? [],
      );
      const livePriceCents = variantResolution.ok
        ? ci.listing.priceCents + variantResolution.variantAdjustCents
        : ci.listing.priceCents;
      const variantUnavailable = !variantResolution.ok;
      const maxQuantity = ci.listing.listingType === "MADE_TO_ORDER"
        ? 1
        : Math.min(99, Math.max(0, ci.listing.stockQuantity ?? 0));
      const stockExceeded = cartItemExceedsLiveStock({
        listingType: ci.listing.listingType,
        quantity: ci.quantity,
        stockQuantity: ci.listing.stockQuantity,
      });
      return {
        id: ci.id,
        quantity: ci.quantity,
        priceCents: ci.priceCents,
        priceVersion: ci.priceVersion,
        livePriceCents,
        livePriceVersion: ci.listing.priceVersion,
        priceChanged: variantUnavailable || livePriceCents !== ci.priceCents || ci.listing.priceVersion !== ci.priceVersion,
        variantUnavailable,
        stockExceeded,
        variantLabels,
        listing: {
          id: ci.listing.id,
          title: ci.listing.title,
          sellerId: ci.listing.sellerId,
          currency: ci.listing.currency || "usd",
          listingType: ci.listing.listingType,
          maxQuantity,
          status: ci.listing.status,
          sellerName:
            seller?.displayName ??
            "Seller",
          sellerVacationMode: !!seller?.vacationMode,
          sellerUnavailable:
            !seller?.chargesEnabled ||
            !!seller?.vacationMode ||
            !!seller?.user?.banned ||
            !!seller?.user?.deletedAt,
          photos: ci.listing.photos.map((p) => ({ url: p.url })),
          // expose seller shipping knobs so Cart UI can display hints
          shippingFlatRate: shippingFlatRateCents != null ? shippingFlatRateCents / 100 : null,
          freeShippingOver: freeOverCents != null ? freeOverCents / 100 : null,
          freeOverCents: freeOverCents ?? 0,
          allowLocalPickup: !!seller?.allowLocalPickup,
          offersGiftWrapping: !!seller?.offersGiftWrapping,
          giftWrappingPriceCents: seller?.giftWrappingPriceCents ?? null,
        },
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    if (isAccountAccessError(err)) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    console.error("GET /api/cart error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
