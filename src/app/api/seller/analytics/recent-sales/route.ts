// src/app/api/seller/analytics/recent-sales/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

    const me = await ensureUserByClerkId(userId);
    const sellerProfile = await prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: { id: true },
    });
    if (!sellerProfile) return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });

    const sales = await prisma.order.findMany({
      where: {
        items: { some: { listing: { sellerId: sellerProfile.id } } },
        paidAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        createdAt: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        giftWrappingPriceCents: true,
        currency: true,
        fulfillmentStatus: true,
        buyer: { select: { name: true } },
        items: {
          where: { listing: { sellerId: sellerProfile.id } },
          take: 1,
          select: { listing: { select: { title: true } } },
        },
      },
    });

    return NextResponse.json({ sales });
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;

    console.error("GET /api/seller/analytics/recent-sales error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
