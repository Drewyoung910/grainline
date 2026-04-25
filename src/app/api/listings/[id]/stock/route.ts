// src/app/api/listings/[id]/stock/route.ts
import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { createNotification } from "@/lib/notifications";
import { sendBackInStock } from "@/lib/email";
import { listingMutationRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { z } from "zod";

const StockPatchSchema = z.object({
  quantity: z.number().int().min(0),
});

export const runtime = "nodejs";

async function syncListingsThreshold(sellerProfileId: string) {
  const [activeCount, sp] = await Promise.all([
    prisma.listing.count({ where: { sellerId: sellerProfileId, status: "ACTIVE" } }),
    prisma.sellerProfile.findUnique({
      where: { id: sellerProfileId },
      select: { listingsBelowThresholdSince: true },
    }),
  ]);
  if (!sp) return;
  if (activeCount < 5 && !sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({
      where: { id: sellerProfileId },
      data: { listingsBelowThresholdSince: new Date() },
    });
  } else if (activeCount >= 5 && sp.listingsBelowThresholdSince) {
    await prisma.sellerProfile.update({
      where: { id: sellerProfileId },
      data: { listingsBelowThresholdSince: null },
    });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { success, reset } = await safeRateLimit(listingMutationRatelimit, userId);
    if (!success) return rateLimitResponse(reset, "Too many listing updates.");

    let stockParsed;
    try {
      stockParsed = StockPatchSchema.parse(await req.json());
    } catch (e) {
      if (e instanceof z.ZodError) {
        return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
      }
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const quantity = Math.max(0, Math.floor(stockParsed.quantity));

    // Ownership check
    const listing = await prisma.listing.findFirst({
      where: { id, seller: { user: { clerkId: userId } } },
      select: { id: true, listingType: true, status: true, isPrivate: true, seller: { select: { id: true, userId: true } } },
    });
    if (!listing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (listing.listingType !== "IN_STOCK") {
      return NextResponse.json({ error: "Only IN_STOCK listings have quantity" }, { status: 400 });
    }

    // NOTE: restocking always promotes SOLD_OUT → ACTIVE. If listing was
    // previously HIDDEN before going SOLD_OUT, seller must re-hide manually.
    // Tracking pre-SOLD_OUT status would require a schema change.
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

    // Track listingsBelowThresholdSince for Guild Member revocation check
    await syncListingsThreshold(listing.seller.id);

    // If stock is low (1–2), notify the seller
    if (updated.stockQuantity !== null && updated.stockQuantity > 0 && updated.stockQuantity <= 2) {
      const recentLowStock = await prisma.notification.findFirst({
        where: {
          userId: listing.seller.userId,
          type: "LOW_STOCK",
          link: "/dashboard/inventory",
          title: `${updated.title} is running low`,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        select: { id: true },
      });
      if (!recentLowStock) await createNotification({
        userId: listing.seller.userId,
        type: "LOW_STOCK",
        title: `${updated.title} is running low`,
        body: `Only ${updated.stockQuantity} left in stock — consider restocking soon`,
        link: `/dashboard/inventory`,
      });
    }

    // If transitioning from SOLD_OUT → ACTIVE, notify subscribers
    if (listing.status === "SOLD_OUT" && newStatus === "ACTIVE") {
      after(async () => {
        try {
          const subscribers = await prisma.stockNotification.findMany({
            where: { listingId: id },
            select: { userId: true, user: { select: { name: true, email: true, banned: true, deletedAt: true } } },
          });
          const activeSubscribers = subscribers.filter((sub) => !sub.user?.banned && !sub.user?.deletedAt);
          const batchSize = 50;
          for (let i = 0; i < activeSubscribers.length; i += batchSize) {
            const batch = activeSubscribers.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(async (sub) => {
              await createNotification({
                userId: sub.userId,
                type: "BACK_IN_STOCK",
                title: `${updated.title} is back in stock!`,
                body: "The piece you saved is available again",
                link: `/listing/${id}`,
              });
              if (sub.user?.email) {
                await sendBackInStock({
                  buyer: { name: sub.user.name, email: sub.user.email },
                  listingTitle: updated.title,
                  listingId: id,
                });
              }
            }));
          }
          if (subscribers.length > 0) {
            await prisma.stockNotification.deleteMany({
              where: { listingId: id, userId: { in: subscribers.map((sub) => sub.userId) } },
            });
          }
        } catch { /* non-fatal */ }
      });
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("PATCH /api/listings/[id]/stock error:", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
