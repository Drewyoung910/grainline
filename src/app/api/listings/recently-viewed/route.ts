// src/app/api/listings/recently-viewed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getIP, rateLimitResponse, safeRateLimitOpen, searchRatelimit } from "@/lib/ratelimit";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimitOpen(searchRatelimit, `recently-viewed:${getIP(req)}`);
  if (!success) return rateLimitResponse(reset, "Too many recently viewed requests.");

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (ids.length === 0) {
    return NextResponse.json({ listings: [] });
  }

  const { userId } = await auth();
  let blockedSellerIds: string[] = [];
  if (userId) {
    try {
      const me = await ensureUserByClerkId(userId);
      blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);
    } catch (err) {
      const accountResponse = accountAccessErrorResponse(err);
      if (accountResponse) return accountResponse;
      throw err;
    }
  }

  const rows = await prisma.listing.findMany({
    where: publicListingWhere({
      id: { in: ids },
      ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
    }),
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

  return NextResponse.json({ listings, ids: ordered.map((r) => r.id) });
}
