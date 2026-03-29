// src/app/api/dev/make-order/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { listingId } = (await req.json()) as { listingId: string };
  if (!listingId) return NextResponse.json({ error: "listingId required" }, { status: 400 });

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  const order = await prisma.order.create({
    data: {
      buyerId: me.id,
      paidAt: new Date(),
      items: {
        create: [{
          listingId,
          quantity: 1,
          priceCents: listing.priceCents,
        }],
      },
    },
    include: { items: true },
  });

  return NextResponse.json({ ok: true, orderId: order.id, items: order.items });
}
