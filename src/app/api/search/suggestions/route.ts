import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { searchRatelimit, getIP, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { auth } from "@clerk/nextjs/server";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { getPopularListingTags } from "@/lib/popularTags";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import {
  BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY,
  LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY,
  normalizeSearchSuggestionQuery,
} from "@/lib/searchSuggestionState";
import { publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { normalizeDisplayNameForLookup } from "@/lib/sanitize";

async function listingFuzzySuggestionRows(q: string, blockedSellerIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('pg_trgm.similarity_threshold', ${String(LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY)}, true)
    `;
    return blockedSellerIds.length > 0
      ? tx.$queryRaw<Array<{ title: string; sim: number }>>`
          SELECT l.title, similarity(l.title, ${q}) as sim, MAX(l."createdAt") as latest_created_at, MAX(l.id) as latest_id
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          INNER JOIN "User" u ON u.id = sp."userId"
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
            AND sp."chargesEnabled" = true
            AND sp."vacationMode" = false
            AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
            AND u.banned = false
            AND u."deletedAt" IS NULL
            AND l.title % ${q}
            AND similarity(l.title, ${q}) > ${LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY}
            AND l.title NOT ILIKE ${`%${q}%`}
            AND l."sellerId" != ALL(${blockedSellerIds})
          GROUP BY l.title
          ORDER BY sim DESC, latest_created_at DESC, latest_id DESC
          LIMIT 2
        `
      : tx.$queryRaw<Array<{ title: string; sim: number }>>`
          SELECT l.title, similarity(l.title, ${q}) as sim, MAX(l."createdAt") as latest_created_at, MAX(l.id) as latest_id
          FROM "Listing" l
          INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
          INNER JOIN "User" u ON u.id = sp."userId"
          WHERE l.status = 'ACTIVE' AND l."isPrivate" = false
            AND sp."chargesEnabled" = true
            AND sp."vacationMode" = false
            AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
            AND u.banned = false
            AND u."deletedAt" IS NULL
            AND l.title % ${q}
            AND similarity(l.title, ${q}) > ${LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY}
            AND l.title NOT ILIKE ${`%${q}%`}
          GROUP BY l.title
          ORDER BY sim DESC, latest_created_at DESC, latest_id DESC
          LIMIT 2
        `;
  });
}

async function blogFuzzySuggestionRows(q: string, blockedSellerIds: string[]) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT set_config('pg_trgm.similarity_threshold', ${String(BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY)}, true)
    `;
    return blockedSellerIds.length > 0
      ? tx.$queryRaw<Array<{ slug: string; title: string }>>`
          SELECT bp.slug, bp.title
          FROM "BlogPost" bp
          INNER JOIN "User" u ON u.id = bp."authorId"
          LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
          LEFT JOIN "User" seller_user ON seller_user.id = sp."userId"
          WHERE bp.status = 'PUBLISHED'
            AND bp."publishedAt" IS NOT NULL
            AND bp."publishedAt" <= NOW()
            AND u.banned = false
            AND u."deletedAt" IS NULL
            AND (
              bp."sellerProfileId" IS NULL
              OR (
                sp."chargesEnabled" = true
                AND sp."vacationMode" = false
                AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
                AND seller_user.banned = false
                AND seller_user."deletedAt" IS NULL
              )
            )
            AND (bp."sellerProfileId" IS NULL OR bp."sellerProfileId" != ALL(${blockedSellerIds}))
            AND bp.title % ${q}
            AND similarity(bp.title, ${q}) > ${BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY}
          ORDER BY similarity(bp.title, ${q}) DESC, bp."publishedAt" DESC, bp.id DESC
          LIMIT 3
        `
      : tx.$queryRaw<Array<{ slug: string; title: string }>>`
          SELECT bp.slug, bp.title
          FROM "BlogPost" bp
          INNER JOIN "User" u ON u.id = bp."authorId"
          LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
          LEFT JOIN "User" seller_user ON seller_user.id = sp."userId"
          WHERE bp.status = 'PUBLISHED'
            AND bp."publishedAt" IS NOT NULL
            AND bp."publishedAt" <= NOW()
            AND u.banned = false
            AND u."deletedAt" IS NULL
            AND (
              bp."sellerProfileId" IS NULL
              OR (
                sp."chargesEnabled" = true
                AND sp."vacationMode" = false
                AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
                AND seller_user.banned = false
                AND seller_user."deletedAt" IS NULL
              )
            )
            AND bp.title % ${q}
            AND similarity(bp.title, ${q}) > ${BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY}
          ORDER BY similarity(bp.title, ${q}) DESC, bp."publishedAt" DESC, bp.id DESC
          LIMIT 3
        `;
  });
}

export async function GET(req: NextRequest) {
  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) {
    return privateResponse(rateLimitResponse(reset, "Too many searches."));
  }
  const q = normalizeSearchSuggestionQuery(req.nextUrl.searchParams.get("q"));
  if (q.length < 2) return privateJson({ suggestions: [] });

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
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);

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
      select: { title: true },
      take: 4,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

    // Seller name matches
    prisma.sellerProfile.findMany({
      where: activeSellerProfileWhere({
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          ...(normalizedDisplayNameQuery
            ? [{ displayNameNormalized: { contains: normalizedDisplayNameQuery, mode: "insensitive" as const } }]
            : []),
        ],
        listings: { some: publicListingWhere() },
        ...(blockedSellerIds.length > 0 ? { id: { notIn: blockedSellerIds } } : {}),
      }),
      select: { displayName: true },
      take: 2,
      orderBy: [{ displayNameNormalized: "asc" }, { id: "asc" }],
    }),

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
  const blogRows = await blogFuzzySuggestionRows(q, blockedSellerIds);

  const seen = new Set<string>();
  const suggestions: string[] = [];
  const blogs: Array<{ slug: string; title: string }> = [];

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
    blogs.push({ slug: b.slug, title: b.title });
  }

  return privateJson({
    suggestions: suggestions.slice(0, 8),
    blogs,
    categories: matchingCategoryValues.map((v) => ({
      value: v,
      label: CATEGORY_LABELS[v],
    })),
  });
}
