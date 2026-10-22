// src/app/api/seller/[id]/map-card/route.ts
// Public read powering the map marker "maker card" overlay. Returns a small,
// non-viewer-specific snapshot of a map-visible seller (name, avatar, cover
// photo, guild level, rating, location, tagline). Only sellers who are
// currently map-eligible (active/orderable + publicMapOptIn) resolve here,
// matching the pin queries on /map and the homepage map section.
import { NextResponse } from "next/server";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { sellerPublicMapCard } from "@/lib/sellerProfilePublicAccess";
import { publicSellerPath } from "@/lib/publicPaths";
import { logServerError } from "@/lib/serverErrorLogger";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rate = await safeRateLimit(searchRatelimit, getIP(req));
    if (!rate.success) {
      return rateLimitResponse(rate.reset, "Too many map requests.");
    }

    const { id } = await params;
    if (!id || id.length > 64) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const seller = await sellerPublicMapCard(id);
    if (!seller) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const ratingMap = await getSellerRatingMap([seller.id]);
    const rating = ratingMap.get(seller.id) ?? null;

    const body = {
      id: seller.id,
      name: seller.displayName ?? "Maker",
      path: publicSellerPath(seller.id, seller.displayName),
      avatarUrl: seller.avatarImageUrl ?? seller.ownerImageUrl ?? null,
      photoUrl: seller.bannerImageUrl ?? seller.coverImageUrl ?? null,
      guildLevel: seller.guildLevel ?? null,
      isFoundingMaker: seller.isFoundingMaker,
      foundingMakerNumber: seller.foundingMakerNumber ?? null,
      city: seller.city ?? null,
      state: seller.state ?? null,
      tagline: seller.tagline ?? null,
      rating,
    };

    // Non-viewer-specific public snapshot; allow short shared caching.
    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, max-age=300" },
    });
  } catch (error) {
    logServerError(error, { source: "seller_map_card" });
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
