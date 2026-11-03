import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { searchRatelimit, getIP, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { auth } from "@clerk/nextjs/server";
import { getBlockedIdsFor } from "@/lib/blocks";
import { getPopularListingTags } from "@/lib/popularTags";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import {
  BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY,
  LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY,
  normalizeSearchSuggestionQuery,
} from "@/lib/searchSuggestionState";
import { publicListingWhere } from "@/lib/listingVisibility";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { normalizeDisplayNameForLookup } from "@/lib/sanitize";
import { sellerPublicListingCards, sellerPublicNameSuggestions } from "@/lib/sellerProfilePublicAccess";
import {
  buildSearchSuggestionItems,
  sellerNameSuggestionInputSupported,
  type SearchSuggestionDetail,
} from "@/lib/searchSuggestionResults";
import { formatCityState } from "@/lib/locationDisplay";
import { logServerError } from "@/lib/serverErrorLogger";

const RECENT_LISTING_SUGGESTIONS = 3;

// Adds price, photo and maker to piece rows. Search must keep working if this
// fails, so a failure only costs the extra facts.
async function listingSuggestionDetails(
  viewerUserId: string | null,
  listingIds: string[],
): Promise<Map<string, SearchSuggestionDetail>> {
  const details = new Map<string, SearchSuggestionDetail>();
  if (listingIds.length === 0) return details;
  try {
    const [rows, cards] = await Promise.all([
      prisma.listing.findMany({
        where: publicListingWhere({ id: { in: listingIds } }),
        select: {
          id: true,
          priceCents: true,
          currency: true,
          photos: { select: { url: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 1 },
        },
      }),
      sellerPublicListingCards(viewerUserId, listingIds),
    ]);
    const cardByListingId = new Map(cards.map((card) => [card.listingId, card]));
    for (const row of rows) {
      const card = cardByListingId.get(row.id);
      details.set(row.id, {
        priceCents: row.priceCents,
        currency: row.currency,
        photoUrl: row.photos[0]?.url ?? null,
        makerName: card?.displayName ?? null,
        location: card ? formatCityState(card.city, card.state) || null : null,
      });
    }
  } catch (error) {
    logServerError(error, { source: "search_suggestion_details", extra: { listingCount: listingIds.length } });
  }
  return details;
}

async function listingFuzzySuggestionRows(q: string, blockedSellerIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('pg_trgm.similarity_threshold', ${String(LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY)}, true)
    `;
    const blockedSellerPredicate = blockedSellerIds.length > 0
      ? Prisma.sql`AND l."sellerId" != ALL(${blockedSellerIds})`
      : Prisma.empty;

    return tx.$queryRaw<Array<{ id: string; title: string; sim: number }>>(Prisma.sql`
      SELECT ranked.id, ranked.title, ranked.sim
      FROM (
        SELECT DISTINCT ON (l.title)
          l.id,
          l.title,
          similarity(l.title, ${q}) AS sim,
          l."createdAt" AS created_at
        FROM "Listing" l
        WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
          AND EXISTS (
            SELECT 1
              FROM public.grainline_seller_public_follower_listing_target(
                l.id,
                l."sellerId"
              )
          )
          AND l.title % ${q}
          AND similarity(l.title, ${q}) > ${LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY}
          AND l.title NOT ILIKE ${`%${q}%`}
          ${blockedSellerPredicate}
        ORDER BY l.title, l."createdAt" DESC, l.id DESC
      ) ranked
      ORDER BY ranked.sim DESC, ranked.created_at DESC, ranked.id DESC
      LIMIT 2
    `);
  });
}

async function blogFuzzySuggestionRows(q: string, blockedUserIds: string[], blockedSellerIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('pg_trgm.similarity_threshold', ${String(BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY)}, true)
    `;
    const blockedAuthorPredicate = blockedUserIds.length > 0
      ? Prisma.sql`AND bp."authorId" != ALL(${blockedUserIds})`
      : Prisma.empty;
    const blockedSellerPredicate = blockedSellerIds.length > 0
      ? Prisma.sql`AND (bp."sellerProfileId" IS NULL OR bp."sellerProfileId" != ALL(${blockedSellerIds}))`
      : Prisma.empty;

    return tx.$queryRaw<Array<{
      slug: string;
      title: string;
      coverImageUrl: string | null;
      readingTimeMinutes: number | null;
    }>>(Prisma.sql`
      SELECT bp.slug, bp.title, bp."coverImageUrl", bp."readingTimeMinutes"
      FROM "BlogPost" bp
      WHERE bp.status = 'PUBLISHED'
        AND bp."publishedAt" IS NOT NULL
        AND bp."publishedAt" <= NOW()
        AND bp."authorAccountActive" = true
        AND CASE
          WHEN bp."sellerProfileId" IS NULL THEN true
          ELSE EXISTS (
            SELECT 1
              FROM public.grainline_seller_public_blog_author(bp."sellerProfileId")
          )
        END
        ${blockedAuthorPredicate}
        ${blockedSellerPredicate}
        AND bp.title % ${q}
        AND similarity(bp.title, ${q}) > ${BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY}
      ORDER BY similarity(bp.title, ${q}) DESC, bp."publishedAt" DESC, bp.id DESC
      LIMIT 3
    `);
  });
}

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) {
    return privateResponse(rateLimitResponse(reset, "Too many searches."));
  }
  const q = normalizeSearchSuggestionQuery(req.nextUrl.searchParams.get("q"));
  const wantsRecentListings = req.nextUrl.searchParams.get("recent") === "1";
  if (q.length < 2 && !wantsRecentListings) return privateJson({ suggestions: [] });

  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    try {
      const me = await ensureUserByClerkId(userId);
      meDbId = me.id;
    } catch (err) {
      const accountResponse = accountAccessErrorResponse(err);
      if (accountResponse) return accountResponse;
      throw err;
    }
  }
  const { blockedUserIds, blockedSellerIds } = await getBlockedIdsFor(meDbId);
  const blockedUserIdList = [...blockedUserIds];

  // The empty search box lists a few new pieces under the recommendations.
  if (q.length < 2) {
    const recentRows = await prisma.listing.findMany({
      where: publicListingWhere(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      select: { id: true, title: true },
      take: RECENT_LISTING_SUGGESTIONS,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const recentDetails = await listingSuggestionDetails(meDbId, recentRows.map((row) => row.id));
    return privateJson({
      suggestions: [],
      recent: buildSearchSuggestionItems({
        listingTitles: recentRows.map((row) => ({ ...row, detail: recentDetails.get(row.id) })),
        tags: [],
        makers: [],
        fuzzyListingTitles: [],
      }),
    });
  }

  const qLower = q.toLowerCase();
  const normalizedDisplayNameQuery = normalizeDisplayNameForLookup(q);
  const tagRows = (await getPopularListingTags(200))
    .filter((tag) => tag.toLowerCase().includes(qLower))
    .slice(0, 2)
    .map((tag) => ({ tag }));

  const [listings, sellers, fuzzyRows] = await Promise.all([
    // Exact title prefix / substring matches
    prisma.listing.findMany({
      where: publicListingWhere({
        title: { contains: q, mode: "insensitive" },
        ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      }),
      select: { id: true, title: true },
      take: 4,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

    // Seller name matches. Input outside the lookup's supported range (an
    // emoji-heavy query whose normalized form is too long) has no maker
    // suggestions instead of failing the whole request.
    sellerNameSuggestionInputSupported(q, normalizedDisplayNameQuery)
      ? sellerPublicNameSuggestions(meDbId, q, normalizedDisplayNameQuery, true, 2)
      : Promise.resolve([]),

    // Fuzzy title suggestions via pg_trgm. Keep threshold conservative to avoid
    // surfacing weak visual/homograph matches as marketplace suggestions.
    listingFuzzySuggestionRows(q, blockedSellerIds),
  ]);

  // Category suggestions: if query matches a category label, include the label
  const matchingCategoryValues = CATEGORY_VALUES.filter((v) =>
    CATEGORY_LABELS[v].toLowerCase().includes(qLower)
  );
  const categoryMatches = matchingCategoryValues.map((v) => CATEGORY_LABELS[v]);

  // Blog post title suggestions. Keep this raw SQL predicate equivalent to
  // publicBlogPostWhere() so global search never suggests a slug that the
  // public blog page will hide.
  const blogRows = await blogFuzzySuggestionRows(q, blockedUserIdList, blockedSellerIds);

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const blogs: Array<{ slug: string; title: string; coverImageUrl: string | null; readingTimeMinutes: number | null }> = [];

  function add(s: string | null | undefined) {
    const trimmed = (s ?? "").trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) return;
    seen.add(trimmed.toLowerCase());
    suggestions.push(trimmed);
  }

  for (const l of listings) add(l.title);
  for (const row of tagRows) add(row.tag);
  for (const cat of categoryMatches) add(cat);
  for (const seller of sellers) add(seller.displayName);
  for (const row of fuzzyRows) add(row.title);

  for (const b of blogRows) {
    blogs.push({
      slug: b.slug,
      title: b.title,
      coverImageUrl: b.coverImageUrl,
      readingTimeMinutes: b.readingTimeMinutes,
    });
  }

  // Typed items open their own target (maker page, tag page); categories
  // stay in `categories` only so the dropdown does not list them twice.
  const details = await listingSuggestionDetails(meDbId, [...listings, ...fuzzyRows].map((row) => row.id));
  const withDetail = <T extends { id: string; title: string }>(row: T) => ({
    id: row.id,
    title: row.title,
    detail: details.get(row.id),
  });
  const items = buildSearchSuggestionItems({
    listingTitles: listings.map(withDetail),
    tags: tagRows.map((row) => row.tag),
    makers: sellers,
    fuzzyListingTitles: fuzzyRows.map(withDetail),
  });

  return privateJson({
    suggestions: suggestions.slice(0, 8),
    items,
    blogs,
    categories: matchingCategoryValues.map((v) => ({
      value: v,
      label: CATEGORY_LABELS[v],
    })),
  });
}
