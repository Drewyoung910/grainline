// src/app/api/listings/recently-viewed/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { sellerPublicRecentlyViewedListings } from "@/lib/sellerProfilePublicAccess";
import { ownerFavoriteListingIds } from "@/lib/favoriteAccess";

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimit(searchRatelimit, `recently-viewed:${getIP(req)}`);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many recently viewed requests."));

  const idsParam = req.nextUrl.searchParams.get("ids") ?? "";
  const ids = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter((id) => /^[A-Za-z0-9._:-]{1,191}$/u.test(id))
    .slice(0, 10);

  if (ids.length === 0) {
    return privateJson({ listings: [] });
  }

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    try {
      const me = await ensureUserByClerkId(userId);
      meId = me.id;
    } catch (err) {
      const accountResponse = accountAccessErrorResponse(err);
      if (accountResponse) return accountResponse;
      throw err;
    }
  }

  const rows = await sellerPublicRecentlyViewedListings(meId, ids);

  // Preserve recency order from the requested ids
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null);
  const orderedIds = ordered.map((r) => r.id);
  const savedListingIds = meId && orderedIds.length > 0
    ? await ownerFavoriteListingIds(meId, orderedIds)
    : new Set<string>();

  const listings = ordered.map((r) => ({
    id: r.id,
    title: r.title,
    priceCents: r.priceCents,
    currency: r.currency,
    photoUrl: r.photoUrl,
    sellerDisplayName: r.sellerDisplayName,
    sellerAvatarImageUrl: r.sellerAvatarImageUrl,
    saved: savedListingIds.has(r.id),
  }));

  return privateJson({ listings, ids: orderedIds });
}
