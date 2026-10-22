// src/app/api/listings/[id]/similar/route.ts
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { logServerError } from "@/lib/serverErrorLogger";
import { sellerActorSimilarListingCandidates } from "@/lib/sellerProfileSimilarListingAccess";

export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rate = await safeRateLimit(searchRatelimit, getIP(req));
    if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many similar-listing requests."));

    const { id } = await params;
    if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(id)) {
      return privateJson({ listings: [] });
    }

    const { userId } = await auth();
    let viewerUserId: string | null = null;
    if (userId) {
      const me = await userClerkGate(prisma, userId);
      if (me?.banned || me?.deletedAt) {
        return privateJson({ error: "Account restricted" }, { status: 403 });
      }
      viewerUserId = me?.id ?? null;
    }
    const rows = await sellerActorSimilarListingCandidates(viewerUserId, id);
    if (rows.length === 0) return privateJson({ listings: [] });
    const { sourcePriceCents: priceCents, sourceTitle: title } = rows[0];

    // Score each candidate with weighted similarity
    const scored = rows.map((r) => {
      const tagScore = Number(r.tagOverlap) * 3; // 3 points per matching tag
      const catScore = r.categoryMatch ? 5 : 0;  // 5 points for same category
      const priceDistance = Math.abs(r.priceCents - priceCents) / Math.max(priceCents, 1);
      const priceScore = Math.max(0, 3 - priceDistance * 3); // 3 points for close price, 0 for far
      // Simple title word overlap
      const titleWords = new Set(title.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
      const rTitleWords = r.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const titleScore = rTitleWords.filter((w) => titleWords.has(w)).length * 2;
      const totalScore = tagScore + catScore + priceScore + titleScore;
      return { ...r, totalScore };
    });

    // Sort by total score descending and take the top TARGET. At launch the
    // marketplace is small enough that per-seller dedup leaves the carousel
    // half-empty; "More from this maker" already covers same-seller items
    // above this section, so allowing duplicates here is fine.
    scored.sort((a, b) =>
      (b.totalScore - a.totalScore) ||
      (b.createdAt.getTime() - a.createdAt.getTime()) ||
      b.id.localeCompare(a.id)
    );
    const TARGET = 12;
    const results = scored.slice(0, TARGET);

    return privateJson({
      listings: results.map((r) => ({
        id: r.id,
        title: r.title,
        priceCents: r.priceCents,
        currency: r.currency,
        status: r.status,
        listingType: r.listingType,
        stockQuantity: r.stockQuantity,
        photoUrl: r.photoUrl,
        photoAltText: r.photoAltText,
        secondPhotoUrl: r.secondPhotoUrl,
        secondPhotoAltText: r.secondPhotoAltText,
        seller: {
          id: r.sellerId,
          displayName: r.sellerDisplayName,
          avatarImageUrl: r.sellerAvatarImageUrl,
          guildLevel: r.sellerGuildLevel,
          city: r.sellerCity,
          state: r.sellerState,
          acceptingNewOrders: r.sellerAcceptingNewOrders,
        },
      })),
    });
  } catch (err) {
    logServerError(err, { source: "listing_similar_route" });
    return privateJson({ error: "Server error" }, { status: 500 });
  }
}
