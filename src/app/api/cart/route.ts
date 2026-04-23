// src/app/api/cart/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";

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
                  include: {
                    user: true,
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
        freeShippingOver?: number | null;
        shippingFlatRate?: number | null;
        allowLocalPickup?: boolean | null;
        offersGiftWrapping?: boolean | null;
        giftWrappingPriceCents?: number | null;
        user?: { email?: string | null } | null;
      };
      const freeOverDollars = seller?.freeShippingOver ?? null;
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
      return {
        id: ci.id,
        quantity: ci.quantity,
        priceCents: ci.priceCents,
        variantLabels,
        listing: {
          id: ci.listing.id,
          title: ci.listing.title,
          sellerId: ci.listing.sellerId,
          status: ci.listing.status,
          sellerName:
            seller?.displayName ??
            "Seller",
          sellerVacationMode: !!(seller as { vacationMode?: boolean })?.vacationMode,
          photos: ci.listing.photos.map((p) => ({ url: p.url })),
          // expose seller shipping knobs so Cart UI can display hints
          shippingFlatRate: seller?.shippingFlatRate ?? null,      // dollars
          freeShippingOver: freeOverDollars,                       // dollars
          freeOverCents: freeOverDollars != null ? Math.round(Number(freeOverDollars) * 100) : 0,
          allowLocalPickup: !!seller?.allowLocalPickup,
          offersGiftWrapping: !!seller?.offersGiftWrapping,
          giftWrappingPriceCents: seller?.giftWrappingPriceCents ?? null,
        },
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("GET /api/cart error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}





