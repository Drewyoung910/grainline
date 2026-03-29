// src/app/api/listings/[id]/stock/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendBackInStock } from "@/lib/email";

export const runtime = "nodejs";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* empty */ }

    const quantity = typeof body.quantity === "number" ? Math.max(0, Math.floor(body.quantity)) : null;
    if (quantity === null || !Number.isFinite(quantity)) {
      return NextResponse.json({ error: "quantity must be a non-negative integer" }, { status: 400 });
    }

    // Ownership check
    const listing = await prisma.listing.findFirst({
      where: { id, seller: { user: { clerkId: userId } } },
      select: { id: true, listingType: true, status: true, isPrivate: true, seller: { select: { userId: true } } },
    });
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (listing.listingType !== "IN_STOCK") {
      return NextResponse.json({ error: "Only IN_STOCK listings have quantity" }, { status: 400 });
    }

    const newStatus =
      quantity <= 0
        ? "SOLD_OUT"
        : listing.status === "SOLD_OUT" && !listing.isPrivate
        ? "ACTIVE"
        : listing.status;

    const updated = await prisma.listing.update({
      where: { id },
      data: { stockQuantity: quantity, status: newStatus },
      select: { id: true, title: true, stockQuantity: true, status: true },
    });

    // If stock is low (1–2), notify the seller
    if (updated.stockQuantity !== null && updated.stockQuantity > 0 && updated.stockQuantity <= 2) {
      await createNotification({
        userId: listing.seller.userId,
        type: "LOW_STOCK",
        title: `${updated.title} is running low`,
        body: `Only ${updated.stockQuantity} left in stock — consider restocking soon`,
        link: `/dashboard/inventory`,
      });
    }

    // If transitioning from SOLD_OUT → ACTIVE, notify subscribers
    if (listing.status === "SOLD_OUT" && newStatus === "ACTIVE") {
      const subscribers = await prisma.stockNotification.findMany({
        where: { listingId: id },
        select: { userId: true, user: { select: { name: true, email: true } } },
      });
      for (const sub of subscribers) {
        await createNotification({
          userId: sub.userId,
          type: "BACK_IN_STOCK",
          title: `${updated.title} is back in stock!`,
          body: "The piece you saved is available again",
          link: `/listing/${id}`,
        });
        if (sub.user?.email) {
          try {
            await sendBackInStock({
              buyer: { name: sub.user.name, email: sub.user.email },
              listingTitle: updated.title,
              listingId: id,
            });
          } catch { /* non-fatal */ }
        }
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/listings/[id]/stock error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
