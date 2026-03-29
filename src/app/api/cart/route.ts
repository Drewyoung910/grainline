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
      return {
        id: ci.id,
        quantity: ci.quantity,
        priceCents: ci.priceCents,
        listing: {
          id: ci.listing.id,
          title: ci.listing.title,
          sellerId: ci.listing.sellerId,
          sellerName:
            seller?.displayName ??
            seller?.user?.email ??
            "Seller",
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





