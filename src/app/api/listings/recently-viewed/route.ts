// src/app/api/listings/recently-viewed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (ids.length === 0) {
    return NextResponse.json({ listings: [] });
  }

  const rows = await prisma.listing.findMany({
    where: {
      id: { in: ids },
      status: "ACTIVE",
      isPrivate: false,
    },
    select: {
      id: true,
      title: true,
      priceCents: true,
      currency: true,
      photos: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true } },
      seller: {
        select: {
          displayName: true,
          avatarImageUrl: true,
          user: { select: { imageUrl: true } },
        },
      },
    },
  });

  // Preserve recency order from the requested ids
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null);

  const listings = ordered.map((r) => ({
    id: r.id,
    title: r.title,
    priceCents: r.priceCents,
    currency: r.currency,
    photoUrl: r.photos[0]?.url ?? null,
    sellerDisplayName: r.seller.displayName ?? "Maker",
    sellerAvatarImageUrl: r.seller.avatarImageUrl ?? r.seller.user?.imageUrl ?? null,
  }));

  return NextResponse.json({ listings });
}
