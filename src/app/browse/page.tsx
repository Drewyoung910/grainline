// src/app/browse/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Category, ListingType, Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import FavoriteButton from "@/components/FavoriteButton";
import FilterSidebar from "@/components/FilterSidebar";
import MobileFilterBar from "@/components/MobileFilterBar";
import SaveSearchButton from "@/components/SaveSearchButton";
import ClickTracker from "@/components/ClickTracker";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { Suspense } from "react";
import RecentlyViewed from "@/components/RecentlyViewed";
import GuildBadge from "@/components/GuildBadge";
import ListingCard from "@/components/ListingCard";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getPopularListingTags } from "@/lib/popularTags";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";

const PAGE_SIZE = 24;

type Search = {
  q?: string;
  page?: string;
  min?: string;
  max?: string;
  sort?: string;
  tag?: string | string[];
  category?: string;
  type?: string;
  ships?: string;
  rating?: string;
  lat?: string;
  lng?: string;
  radius?: string;
  view?: string;
};

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function StarsInline({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="relative leading-none inline-block align-middle" aria-hidden>
      <span className="text-neutral-300">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <span className="text-amber-500">★★★★★</span>
      </span>
    </span>
  );
}

type ListingWithIncludes = Awaited<ReturnType<typeof fetchListings>>[number];

async function fetchListings(where: Prisma.ListingWhereInput, orderBy: Prisma.ListingOrderByWithRelationInput | Prisma.ListingOrderByWithRelationInput[], take: number, skip: number, withFavCount: boolean) {
  return prisma.listing.findMany({
    where,
    orderBy,
    take,
    skip,
    include: {
      photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true, altText: true } },
      seller: { include: { user: true } },
      ...(withFavCount ? { _count: { select: { favorites: true } } } : {}),
    },
  });
}

function scoreListings(listings: ListingWithIncludes[], query?: string) {
  const qLower = (query ?? "").toLowerCase().trim();
  const searchTerms = qLower.split(/\s+/).filter(Boolean).slice(0, 6);

  return listings
    .map((l) => {
      // Primary factor: pre-computed qualityScore (40% weight when searching)
      const qualityBase = l.qualityScore ?? 0;

      if (!qLower || searchTerms.length === 0) {
        return { listing: l, score: qualityBase };
      }

      // Text relevance: score per search term, then normalize (60% weight)
      const titleLower = (l.title ?? "").toLowerCase();
      const descLower = (l.description ?? "").toLowerCase();
      const tagsLower = (l.tags ?? []).map((t) => t.toLowerCase());
      let textScore = 0;

      // Bonus for exact full-phrase match in title
      if (titleLower === qLower) textScore += 0.5;
      else if (titleLower.includes(qLower)) textScore += 0.25;

      // Per-word scoring
      for (const term of searchTerms) {
        // Title matches (highest weight)
        if (titleLower.includes(term)) textScore += 0.2;
        // Tag matches (medium weight)
        if (tagsLower.includes(term)) textScore += 0.25;
        else if (tagsLower.some((t) => t.includes(term))) textScore += 0.1;
        // Description matches (low weight)
        if (descLower.includes(term)) textScore += 0.05;
      }

      // Normalize by term count so 3-word queries don't auto-score 3x
      const normalizedText = textScore / Math.max(1, searchTerms.length);

      // Blend: 60% text relevance, 40% quality
      const score = normalizedText * 0.6 + qualityBase * 0.4;
      return { listing: l, score };
    })
    .sort((a, b) => b.score - a.score);
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const categoryRaw = sp.category?.toUpperCase() ?? "";
  const categoryFilter = CATEGORY_VALUES.includes(categoryRaw) ? categoryRaw : null;
  const pageRaw = Number.parseInt(sp.page ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const hasTags = Array.isArray(sp.tag) ? sp.tag.length > 0 : Boolean(sp.tag);
  const hasIndexBlockingFilters = Boolean(
    q ||
    sp.min ||
    sp.max ||
    sp.sort ||
    sp.type ||
    sp.ships ||
    sp.rating ||
    sp.lat ||
    sp.lng ||
    sp.radius ||
    (sp.view && sp.view !== "grid") ||
    hasTags,
  );
  const canonicalParams = new URLSearchParams();
  if (categoryFilter) canonicalParams.set("category", categoryFilter.toLowerCase());
  if (!hasIndexBlockingFilters && page > 1) canonicalParams.set("page", String(page));
  const canonicalQuery = canonicalParams.toString();
  const canonical = `https://thegrainline.com/browse${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  const robots = hasIndexBlockingFilters ? { index: false, follow: true } : undefined;

  if (q) {
    const title = `${q} — Handmade Woodworking | Grainline`;
    const description = `Find handmade woodworking items matching "${q}" on Grainline`;
    return { title, description, robots, openGraph: { title, description, url: canonical }, alternates: { canonical } };
  }
  if (categoryFilter) {
    const label = CATEGORY_LABELS[categoryFilter] ?? categoryFilter;
    const pageSuffix = !hasIndexBlockingFilters && page > 1 ? ` - Page ${page}` : "";
    const title = `Handmade ${label}${pageSuffix} | Grainline`;
    const description = `Shop handmade ${label.toLowerCase()} from local woodworking artisans`;
    return { title, description, robots, openGraph: { title, description, url: canonical }, alternates: { canonical } };
  }
  const pageSuffix = !hasIndexBlockingFilters && page > 1 ? ` - Page ${page}` : "";
  return {
    title: `Browse Handmade Woodworking${pageSuffix}`,
    description: "Browse thousands of unique handmade woodworking pieces from local artisans",
    openGraph: {
      title: "Browse Handmade Woodworking",
      description: "Browse thousands of unique handmade woodworking pieces from local artisans",
      url: canonical,
    },
    robots,
    alternates: { canonical },
  };
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  // Resolve user early for block filtering
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meDbId = me?.id ?? null;
  }
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);

  const q = (sp.q ?? "").slice(0, 200);
  const page = sp.page ?? "1";
  const min = sp.min ?? "";
  const max = sp.max ?? "";
  const sortRaw = sp.sort ?? "";
  const sort = sortRaw || (q ? "relevant" : "newest");
  const view = sp.view === "list" ? "list" : "grid";

  const rawTag = sp.tag;
  const selectedTags = rawTag == null
    ? []
    : Array.isArray(rawTag)
    ? uniq(rawTag.filter(Boolean).map((t) => t.trim()).slice(0, 10))
    : [rawTag.trim()].filter(Boolean);

  const pageNumRaw = Number.parseInt(page || "1", 10);
  const pageNum = Math.min(Number.isFinite(pageNumRaw) && pageNumRaw > 0 ? pageNumRaw : 1, 500);

  // New filters
  const categoryRaw = sp.category?.toUpperCase() ?? "";
  const categoryFilter = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;
  const typeFilter = sp.type === "IN_STOCK" ? ListingType.IN_STOCK
    : sp.type === "MADE_TO_ORDER" ? ListingType.MADE_TO_ORDER
    : null;
  const shipsRaw = sp.ships ? Number(sp.ships) : null;
  const shipsFilter = shipsRaw != null && Number.isFinite(shipsRaw) ? Math.max(1, shipsRaw) : null;
  const ratingRaw = sp.rating ? Number(sp.rating) : null;
  const ratingFilter = ratingRaw != null && Number.isFinite(ratingRaw) ? Math.max(1, Math.min(5, ratingRaw)) : null;
  const latRaw = sp.lat ? Number(sp.lat) : null;
  const latFilter = latRaw != null && Number.isFinite(latRaw) ? latRaw : null;
  const lngRaw = sp.lng ? Number(sp.lng) : null;
  const lngFilter = lngRaw != null && Number.isFinite(lngRaw) ? lngRaw : null;
  const radiusRaw = sp.radius ? Number(sp.radius) : null;
  const radiusFilter = radiusRaw != null && Number.isFinite(radiusRaw) ? Math.max(1, radiusRaw) : null;
  const hasLocationFilter = latFilter !== null && lngFilter !== null && radiusFilter !== null;
  const popularTags = await getPopularListingTags(q ? 200 : 12);

  // Price filter
  const priceFilter: { gte?: number; lte?: number } = {};
  const minNum = Number(min);
  const maxNum = Number(max);
  if (Number.isFinite(minNum) && min !== "" && minNum >= 0) priceFilter.gte = Math.round(Math.min(minNum, 500000) * 100);
  if (Number.isFinite(maxNum) && max !== "" && maxNum >= 0) priceFilter.lte = Math.round(Math.min(maxNum, 500000) * 100);

  // Pre-pass: collect seller ID constraints from location filters. Rating is
  // applied via SellerRatingSummary so browse does not aggregate every review.
  const sellerIdFilters: string[][] = [];

  if (hasLocationFilter) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM "SellerProfile"
      WHERE lat IS NOT NULL AND lng IS NOT NULL
      AND (
        6371 * 2 * asin(sqrt(
          pow(sin(radians((lat::float - ${latFilter!}) / 2)), 2) +
          cos(radians(${latFilter!})) * cos(radians(lat::float)) *
          pow(sin(radians((lng::float - ${lngFilter!}) / 2)), 2)
        ))
      ) <= ${radiusFilter! * 1.60934}
    `;
    sellerIdFilters.push(rows.map((r) => r.id));
  }

  // Partial tag matches use cached popular tags instead of per-request unnest.
  let partialTagMatches: string[] = [];
  if (q) {
    const searchWords = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    if (searchWords.length > 0) {
      const lowerWords = searchWords.map((word) => word.toLowerCase());
      partialTagMatches = popularTags
        .filter((tag) => lowerWords.some((word) => tag.toLowerCase().includes(word)))
        .slice(0, 20);
    }
  }

  // Build WHERE
  const where: Prisma.ListingWhereInput = publicListingWhere(
    blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {},
  );

  if (q) {
    // Split query into individual words for broad matching.
    // "walnut dining table" matches listings with ANY of those words
    // in title, tags, description, or seller name — not just exact phrase.
    const searchWords = q.trim().split(/\s+/).filter(Boolean).slice(0, 6);
    const wordConditions: Prisma.ListingWhereInput[] = searchWords.flatMap((word) => [
      { title: { contains: word, mode: "insensitive" as const } },
      { description: { contains: word, mode: "insensitive" as const } },
    ]);
    // Tag matching: check each word against tags individually
    const tagWordConditions: Prisma.ListingWhereInput[] = searchWords.map((word) => ({
      tags: { has: word.toLowerCase() },
    }));

    where.OR = [
      // Full phrase match (highest relevance, scored in JS)
      { title: { contains: q, mode: "insensitive" as const } },
      // Individual word matches in title and description
      ...wordConditions,
      // Individual word matches in tags
      ...tagWordConditions,
      // Partial tag matches (existing logic)
      ...(partialTagMatches.length > 0 ? [{ tags: { hasSome: partialTagMatches } }] : []),
      // Seller name match
      { seller: { displayName: { contains: q, mode: "insensitive" as const } } },
    ];
  }
  if (Object.keys(priceFilter).length > 0) where.priceCents = priceFilter;
  if (selectedTags.length > 0) where.tags = { hasSome: selectedTags.map((t) => t.toLowerCase()) };
  if (categoryFilter) where.category = categoryFilter;
  if (typeFilter) where.listingType = typeFilter;
  if (shipsFilter && Number.isFinite(shipsFilter)) {
    // Only set IN_STOCK listingType when no explicit type filter is set
    if (!typeFilter) {
      where.listingType = ListingType.IN_STOCK;
    }
    where.shipsWithinDays = { lte: shipsFilter };
  }
  if (ratingFilter && Number.isFinite(ratingFilter)) {
    const sellerWhere = (where.seller ?? {}) as Prisma.SellerProfileWhereInput;
    where.seller = {
      ...sellerWhere,
      ratingSummary: {
        is: {
          averageRating: { gte: ratingFilter },
          reviewCount: { gt: 0 },
        },
      },
    };
  }

  // Apply intersected seller ID constraints (preserve block notIn if set)
  const blockNotIn = blockedSellerIds.length > 0 ? { notIn: blockedSellerIds } : {};
  if (sellerIdFilters.length === 1) {
    where.sellerId = { in: sellerIdFilters[0], ...blockNotIn };
  } else if (sellerIdFilters.length > 1) {
    const bSet = new Set(sellerIdFilters[1]);
    where.sellerId = { in: sellerIdFilters[0].filter((id) => bSet.has(id)), ...blockNotIn };
  }

  // ORDER BY
  const orderBy =
    sort === "price_asc" ? { priceCents: "asc" as const }
    : sort === "price_desc" ? { priceCents: "desc" as const }
    : sort === "popular" ? { favorites: { _count: "desc" as const } }
    : sort === "relevant" ? { qualityScore: "desc" as const }
    : { createdAt: "desc" as const };

  // Fetch listings
  let listings: ListingWithIncludes[];
  let total: number;

  if (sort === "relevant" && q) {
    // Search relevance: fetch up to 200, re-score with text-match bonus, paginate
    const all = await fetchListings(where, { qualityScore: "desc" }, 200, 0, true);
    const scored = scoreListings(all, q);
    total = scored.length;
    listings = scored
      .slice((pageNum - 1) * PAGE_SIZE, pageNum * PAGE_SIZE)
      .map((s) => s.listing);
  } else {
    [listings, total] = await Promise.all([
      fetchListings(where, orderBy, PAGE_SIZE, (pageNum - 1) * PAGE_SIZE, false),
      prisma.listing.count({ where }),
    ]);
  }

  const visiblePopularTags = popularTags.slice(0, 12);

  // Saved set for current user
  let savedSet = new Set<string>();
  if (meDbId && listings.length) {
    const favs = await prisma.favorite.findMany({
      where: { userId: meDbId, listingId: { in: listings.map((l) => l.id) } },
      select: { listingId: true },
    });
    savedSet = new Set(favs.map((f) => f.listingId));
  }

  // Seller ratings for display
  const sellerIds = Array.from(new Set(listings.map((l) => l.sellerId)));
  const sellerRatings = await getSellerRatingMap(sellerIds);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(pageNum, 1), totalPages);

  // URL helpers
  function makePageHref(n: number) {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (min) p.set("min", min);
    if (max) p.set("max", max);
    if (sort && sort !== (q ? "relevant" : "newest")) p.set("sort", sort);
    if (categoryFilter) p.set("category", categoryFilter);
    if (typeFilter) p.set("type", typeFilter);
    if (shipsFilter) p.set("ships", String(shipsFilter));
    if (ratingFilter) p.set("rating", String(ratingFilter));
    if (hasLocationFilter) {
      p.set("lat", String(latFilter));
      p.set("lng", String(lngFilter));
      p.set("radius", String(radiusFilter));
    }
    for (const t of selectedTags) p.append("tag", t);
    if (view !== "grid") p.set("view", view);
    p.set("page", String(n));
    return `/browse?${p.toString()}`;
  }

  function viewToggleHref(v: string) {
    const p = new URLSearchParams(
      Object.fromEntries(
        [
          ["q", q], ["min", min], ["max", max],
          ["sort", sort !== (q ? "relevant" : "newest") ? sort : ""],
          ["category", categoryFilter ?? ""], ["type", typeFilter ?? ""],
          ["ships", shipsFilter ? String(shipsFilter) : ""],
          ["rating", ratingFilter ? String(ratingFilter) : ""],
        ].filter(([, val]) => val)
      )
    );
    for (const t of selectedTags) p.append("tag", t);
    if (hasLocationFilter) { p.set("lat", String(latFilter)); p.set("lng", String(lngFilter)); p.set("radius", String(radiusFilter)); }
    p.set("view", v);
    return `/browse?${p.toString()}`;
  }

  // ── No results experience ──────────────────────────────────────────────────
  if (total === 0) {
    const featured = await prisma.listing.findMany({
      where: publicListingWhere(),
      orderBy: { favorites: { _count: "desc" } },
      take: 4,
      include: { photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true, altText: true } } },
    });

    return (
      <div className="bg-gradient-to-b from-amber-50/30 via-amber-50/10 to-white min-h-[100svh]">
      <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <MobileFilterBar popularTags={visiblePopularTags} />
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
          <div className="sticky top-4 self-start">
            <FilterSidebar popularTags={visiblePopularTags} />
          </div>
          <div className="flex-1 min-w-0 space-y-8">
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold">
                {q ? `No pieces found for "${q}"` : "No pieces found"}
              </h1>
              <p className="text-neutral-500 text-sm">
                Try broadening your search or browse all makers.
              </p>
            </div>

            {visiblePopularTags.length > 0 && (
              <div>
                <div className="font-medium mb-2">Try searching for:</div>
                <div className="flex flex-wrap gap-2">
                  {visiblePopularTags.slice(0, 3).map((t) => (
                    <Link
                      key={t}
                      href={`/browse?q=${encodeURIComponent(t)}`}
                      className="rounded-full border px-3 py-1 text-sm hover:bg-neutral-50"
                    >
                      #{t}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {featured.length > 0 && (
              <div>
                <div className="font-medium mb-3">Featured listings</div>
                <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {featured.map((l) => (
                    <li key={l.id} className="border border-neutral-200 overflow-hidden">
                      <Link href={publicListingPath(l.id, l.title)} className="block">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={l.photos[0]?.url ?? "/favicon.ico"} alt={l.photos[0]?.altText ?? l.title} loading="lazy" className="h-36 w-full object-cover" />
                        <div className="p-2 text-sm font-medium truncate">{l.title}</div>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Link href="/browse" className="inline-flex items-center rounded-lg border px-4 py-2 text-sm hover:bg-neutral-50">
              Browse all listings
            </Link>
          </div>
        </div>
      </main>
      </div>
    );
  }

  // ── Pager component ────────────────────────────────────────────────────────
  const Pager = () => (
    <nav className="flex items-center gap-2 text-sm">
      {clampedPage > 1 ? (
        <Link href={makePageHref(clampedPage - 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">← Prev</Link>
      ) : (
        <span className="rounded border px-3 py-1 text-neutral-500">← Prev</span>
      )}
      {totalPages > 1 && (
        <span className="px-2 text-neutral-500">
          Page <span className="font-medium">{clampedPage}</span> of {totalPages}
        </span>
      )}
      {clampedPage < totalPages ? (
        <Link href={makePageHref(clampedPage + 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">Next →</Link>
      ) : (
        <span className="rounded border px-3 py-1 text-neutral-500">Next →</span>
      )}
    </nav>
  );

  // ── Grid card renderer ─────────────────────────────────────────────────────
  function GridCard({ l }: { l: ListingWithIncludes }) {
    const shop = sellerRatings.get(l.sellerId);
    return (
      <ClickTracker listingId={l.id}>
        <ListingCard
          listing={{
            id: l.id,
            title: l.title,
            priceCents: l.priceCents,
            currency: l.currency,
            status: l.status,
            listingType: l.listingType,
            stockQuantity: l.stockQuantity ?? null,
            photoUrl: l.photos[0]?.url ?? null,
            photoAltText: l.photos[0]?.altText ?? null,
            secondPhotoUrl: l.photos[1]?.url ?? null,
            secondPhotoAltText: l.photos[1]?.altText ?? null,
            seller: {
              id: l.sellerId,
              displayName: l.seller.displayName ?? null,
              avatarImageUrl: l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null,
              guildLevel: l.seller.guildLevel ?? null,
              city: l.seller.city ?? null,
              state: l.seller.state ?? null,
              acceptingNewOrders: l.seller.acceptingNewOrders ?? null,
            },
            rating: shop && shop.count > 0 ? { avg: shop.avg, count: shop.count } : null,
          }}
          initialSaved={savedSet.has(l.id)}
          variant="grid"
        />
      </ClickTracker>
    );
  }

  // ── List card renderer ─────────────────────────────────────────────────────
  function ListCard({ l }: { l: ListingWithIncludes }) {
    const img = l.photos[0]?.url ?? "/favicon.ico";
    const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Maker";
    const shop = sellerRatings.get(l.sellerId);
    const isInStock = l.listingType === "IN_STOCK";
    const outOfStock = l.status === "SOLD_OUT" || (isInStock && (l.stockQuantity ?? 0) <= 0);

    return (
      <div className="flex">
        <Link href={publicListingPath(l.id, l.title)} className="shrink-0 w-36 sm:w-44 aspect-square overflow-hidden bg-neutral-100">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={l.title} src={img} loading="lazy" className="h-full w-full object-cover" />
        </Link>
        <div className="flex-1 min-w-0 p-4">
          <div className="flex items-start justify-between gap-3">
            <Link href={publicListingPath(l.id, l.title)} className="font-medium hover:underline leading-snug">
              {l.title}
            </Link>
            <div className="shrink-0 font-medium">${(l.priceCents / 100).toFixed(2)}</div>
          </div>

          <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
            <Link href={publicSellerPath(l.sellerId, l.seller.displayName)} className="text-xs text-neutral-500 hover:underline">
              {sellerName}
            </Link>
            <GuildBadge level={l.seller.guildLevel} showLabel={false} size={22} />
          </div>
          {l.seller.acceptingNewOrders === false && (
            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-1 inline-block">
              Not accepting new orders
            </span>
          )}

          {shop && shop.count > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-neutral-600 mt-1">
              <StarsInline value={shop.avg} />
              <span>{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
              <span className="text-neutral-500">({shop.count})</span>
            </div>
          )}

          <div className="mt-1.5 text-xs text-neutral-500">
            {isInStock ? (
              outOfStock ? (
                <span className="text-red-600">Out of Stock</span>
              ) : (
                <span className="text-green-700">
                  In Stock{l.stockQuantity != null ? ` (${l.stockQuantity})` : ""}
                  {l.shipsWithinDays != null ? ` · ships in ${l.shipsWithinDays}d` : ""}
                </span>
              )
            ) : (
              <span>
                Made to order
                {l.processingTimeMaxDays != null
                  ? ` · ${l.processingTimeMinDays ?? 1}–${l.processingTimeMaxDays}d`
                  : ""}
              </span>
            )}
          </div>

          <div className="mt-1">
            <FavoriteButton listingId={l.id} initialSaved={savedSet.has(l.id)} />
          </div>
        </div>
      </div>
    );
  }

  // ── Page render ────────────────────────────────────────────────────────────
  const activeFilterCount = [
    categoryFilter, typeFilter, shipsFilter, ratingFilter, hasLocationFilter ? "loc" : null,
    min, max, ...selectedTags,
  ].filter(Boolean).length;

  return (
    <div className="bg-gradient-to-b from-amber-50/30 via-amber-50/10 to-white min-h-[100svh]">
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <MobileFilterBar popularTags={visiblePopularTags} />
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        {/* Left sidebar */}
        <div className="sticky top-4 self-start">
          <FilterSidebar popularTags={visiblePopularTags} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* Top bar: result count, view toggle, save search, pager */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold font-display">
                {q ? (
                  <>Results for <span className="italic">&quot;{q}&quot;</span></>
                ) : categoryFilter ? (
                  CATEGORY_LABELS[categoryFilter] ?? "Browse"
                ) : (
                  "Browse"
                )}
              </h1>
              <p className="text-sm text-neutral-500 mt-0.5">
                {total} {total === 1 ? "result" : "results"}
                {activeFilterCount > 0 && (
                  <> · {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active</>
                )}
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* View toggle */}
              <div className="flex rounded border overflow-hidden text-sm">
                <Link
                  href={viewToggleHref("grid")}
                  className={`px-3 py-1.5 ${view === "grid" ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}
                >
                  Grid
                </Link>
                <Link
                  href={viewToggleHref("list")}
                  className={`px-3 py-1.5 ${view === "list" ? "bg-neutral-900 text-white" : "hover:bg-neutral-50"}`}
                >
                  List
                </Link>
              </div>

              <SaveSearchButton signedIn={!!userId} />
              <Pager />
            </div>
          </div>

          {/* Listings */}
          {view === "grid" ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-8">
              {listings.map((l) => (
                <GridCard key={l.id} l={l} />
              ))}
            </ul>
          ) : (
            <ul className="space-y-4">
              {listings.map((l) => (
                <ClickTracker key={l.id} listingId={l.id} className="card-listing">
                  <ListCard l={l} />
                </ClickTracker>
              ))}
            </ul>
          )}

          {/* Bottom pager */}
          {totalPages > 1 && (
            <div className="pt-4 flex justify-center">
              <Pager />
            </div>
          )}
        </div>
      </div>

      {/* Recently Viewed */}
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <Suspense>
          <RecentlyViewed />
        </Suspense>
      </div>

      {/* Browse by city */}
      <BrowseByCity />
    </main>
    </div>
  );
}

async function BrowseByCity() {
  const metros = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        { listings: { some: publicListingWhere() } },
        { listingCityMetros: { some: publicListingWhere() } },
      ],
    },
    select: { id: true, slug: true, name: true, state: true, parentMetroId: true },
    orderBy: { name: "asc" },
  });

  if (metros.length === 0) return null;

  const majors = metros.filter((m) => !m.parentMetroId);
  const children = metros.filter((m) => m.parentMetroId);

  return (
    <section className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-10 border-t border-neutral-100">
      <h2 className="text-base font-semibold text-neutral-800 mb-4">Browse by city</h2>
      <div className="space-y-4">
        {majors.map((major) => {
          const subs = children.filter((c) => c.parentMetroId === major.id);
          return (
            <div key={major.id}>
              <Link
                href={`/browse/${major.slug}`}
                className="text-sm font-medium text-neutral-900 hover:underline"
              >
                {major.name}, {major.state}
              </Link>
              {subs.length > 0 && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {subs.map((sub) => (
                    <Link
                      key={sub.id}
                      href={`/browse/${sub.slug}`}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      {sub.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
