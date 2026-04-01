// src/app/api/dev/make-order/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { z } from "zod";

const DevOrderSchema = z.object({
  listingId: z.string().min(1),
});

export async function POST(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Disabled in production" }, { status: 403 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const me = await prisma.user.findUnique({ where: { clerkId: userId } });
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let devParsed;
  try {
    devParsed = DevOrderSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { listingId } = devParsed;

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
