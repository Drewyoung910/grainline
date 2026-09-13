// src/app/api/listings/recently-viewed/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimit(searchRatelimit, `recently-viewed:${getIP(req)}`);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many recently viewed requests."));

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);

  if (ids.length === 0) {
    return privateJson({ listings: [] });
  }

  const { userId } = await auth();
  let meId: string | null = null;
  let blockedSellerIds: string[] = [];
  if (userId) {
    try {
      const me = await ensureUserByClerkId(userId);
      meId = me.id;
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
  const orderedIds = ordered.map((r) => r.id);
  const savedListingIds =
    meId && orderedIds.length > 0
      ? new Set(
          (
            await prisma.favorite.findMany({
              where: { userId: meId, listingId: { in: orderedIds } },
              select: { listingId: true },
            })
          ).map((favorite) => favorite.listingId),
        )
      : new Set<string>();

  const listings = ordered.map((r) => ({
    id: r.id,
    title: r.title,
    priceCents: r.priceCents,
    currency: r.currency,
    photoUrl: r.photos[0]?.url ?? null,
    sellerDisplayName: r.seller.displayName ?? "Maker",
    sellerAvatarImageUrl: r.seller.avatarImageUrl ?? r.seller.user?.imageUrl ?? null,
    saved: savedListingIds.has(r.id),
  }));

  return privateJson({ listings, ids: orderedIds });
}
