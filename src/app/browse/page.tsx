// src/app/browse/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import { Category, ListingType } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import FavoriteButton from "@/components/FavoriteButton";
import FilterSidebar from "@/components/FilterSidebar";
import MobileFilterBar from "@/components/MobileFilterBar";
import SaveSearchButton from "@/components/SaveSearchButton";
import SegmentedControl from "@/components/SegmentedControl";
import SortMenu from "@/components/SortMenu";
import ClickTracker from "@/components/ClickTracker";
import FilterChipLink from "@/components/FilterChipLink";
import RollingNumber from "@/components/RollingNumber";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { Suspense } from "react";
import FlipList from "@/components/FlipList";
import RecentlyViewed from "@/components/RecentlyViewed";
import GuildBadge from "@/components/GuildBadge";
import ListingCard from "@/components/ListingCard";
import { publicListingWhere } from "@/lib/listingVisibility";
import { getPopularListingTags } from "@/lib/popularTags";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { normalizeDisplayNameForLookup, truncateText } from "@/lib/sanitize";
import { DEFAULT_CURRENCY, formatCurrencyCents, parseMoneyInputToCents } from "@/lib/money";
import { parseBoundedDecimalParam, parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { normalizeTags } from "@/lib/tags";
import { BrowseIndexSkeleton } from "@/components/LocalDiscoverySkeletons";
import {
  sellerPublicListingCards,
  type SellerPublicListingCard,
} from "@/lib/sellerProfilePublicAccess";
import { ownerFavoriteListingIds } from "@/lib/favoriteAccess";
import {
  listingPublicCatalogPage,
  type ListingPublicCatalogFilter,
  type ListingPublicCatalogItem,
  type ListingPublicCatalogPage,
  type ListingPublicCatalogSort,
} from "@/lib/listingPublicCatalogAccess";

const PAGE_SIZE = 24;
const MAX_SHIPS_WITHIN_DAYS = 365;
const MAX_BROWSE_RADIUS_MILES = 500;

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

function StarsInline({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span
      className="relative leading-none inline-block align-middle"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <span className="text-neutral-300" aria-hidden="true">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <span className="text-amber-500" aria-hidden="true">★★★★★</span>
      </span>
    </span>
  );
}

type ListingRow = ListingPublicCatalogItem;
type ListingWithIncludes = ListingRow & { seller: SellerPublicListingCard };

async function hydrateSellerCards(viewerUserId: string | null, rows: ListingRow[]) {
  const cards = await sellerPublicListingCards(viewerUserId, rows.map((listing) => listing.id));
  const cardByListingId = new Map(cards.map((seller) => [seller.listingId, seller]));
  return rows.flatMap((listing): ListingWithIncludes[] => {
    const seller = cardByListingId.get(listing.id);
    if (!seller || seller.sellerProfileId !== listing.sellerId) return [];
    return [{ ...listing, seller }];
  });
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
  const page = parseBoundedPositiveIntParam(sp.page, 1, 500);
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

export default function BrowsePage(props: {
  searchParams: Promise<Search>;
}) {
  return (
    <Suspense fallback={<BrowseIndexSkeleton />}>
      <BrowseContent {...props} />
    </Suspense>
  );
}

async function BrowseContent({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;

  // Resolve the optional viewer for block-aware catalog and seller authorities.
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const me = await userIdByClerkId(prisma, userId);
    meDbId = me?.id ?? null;
  }
  const q = truncateText(sp.q ?? "", 200).trim();
  const normalizedDisplayNameQuery = normalizeDisplayNameForLookup(q);
  const min = sp.min ?? "";
  const max = sp.max ?? "";
  const sortRaw = sp.sort ?? "";
  const supportedSorts = new Set<ListingPublicCatalogSort>([
    "newest",
    "quality",
    "relevant",
    "popular",
    "price_asc",
    "price_desc",
  ]);
  const defaultSort: ListingPublicCatalogSort = q ? "relevant" : "newest";
  const sort = sortRaw === "relevant" && !q
    ? "quality"
    : supportedSorts.has(sortRaw as ListingPublicCatalogSort)
      ? sortRaw as ListingPublicCatalogSort
      : defaultSort;
  const view = sp.view === "list" ? "list" : "grid";

  const rawTag = sp.tag;
  const selectedTags = normalizeTags(
    rawTag == null ? [] : Array.isArray(rawTag) ? rawTag : [rawTag],
    10,
  );

  const pageNum = parseBoundedPositiveIntParam(sp.page, 1, 500);

  // New filters
  const categoryRaw = sp.category?.toUpperCase() ?? "";
  const categoryFilter = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;
  const typeFilter = sp.type === "IN_STOCK" ? ListingType.IN_STOCK
    : sp.type === "MADE_TO_ORDER" ? ListingType.MADE_TO_ORDER
    : null;
  const shipsFilter = sp.ships ? parseBoundedPositiveIntParam(sp.ships, 0, MAX_SHIPS_WITHIN_DAYS) : null;
  const ratingFilter = parseBoundedDecimalParam(sp.rating, 1, 5);
  const latFilter = parseBoundedDecimalParam(sp.lat, -90, 90);
  const lngFilter = parseBoundedDecimalParam(sp.lng, -180, 180);
  const radiusFilter = parseBoundedDecimalParam(sp.radius, 1, MAX_BROWSE_RADIUS_MILES);
  const hasLocationFilter = latFilter !== null && lngFilter !== null && radiusFilter !== null;
  const popularTags = await getPopularListingTags(q ? 200 : 12);

  const minCents = parseMoneyInputToCents(min);
  const maxCents = parseMoneyInputToCents(max);
  const boundedMinCents = minCents !== null && minCents >= 0
    ? Math.min(minCents, 50_000_000)
    : undefined;
  const boundedMaxCents = maxCents !== null && maxCents >= 0
    ? Math.min(maxCents, 50_000_000)
    : undefined;
  const invalidPriceRange = boundedMinCents !== undefined
    && boundedMaxCents !== undefined
    && boundedMinCents > boundedMaxCents;

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

  const catalogFilter: ListingPublicCatalogFilter = {
    ...(q ? {
      query: q,
      ...(normalizedDisplayNameQuery
        ? { normalizedSellerQuery: normalizedDisplayNameQuery }
        : {}),
      ...(partialTagMatches.length > 0 ? { partialTagMatches } : {}),
    } : {}),
    ...(selectedTags.length > 0 ? { selectedTags } : {}),
    ...(boundedMinCents !== undefined ? { minPriceCents: boundedMinCents } : {}),
    ...(boundedMaxCents !== undefined ? { maxPriceCents: boundedMaxCents } : {}),
    ...(categoryFilter ? { category: categoryFilter } : {}),
    ...(typeFilter || shipsFilter
      ? { listingType: typeFilter ?? ListingType.IN_STOCK }
      : {}),
    ...(shipsFilter ? { shipsWithinDays: shipsFilter } : {}),
    ...(ratingFilter !== null ? { minimumSellerRating: ratingFilter } : {}),
    ...(hasLocationFilter ? {
      locationLat: latFilter!,
      locationLng: lngFilter!,
      locationRadiusMiles: radiusFilter!,
    } : {}),
    sort,
  };

  let catalogPage: ListingPublicCatalogPage = invalidPriceRange
    ? Object.freeze({
      total: 0,
      listings: Object.freeze([]),
      categoryCounts: Object.freeze([]),
    })
    : await listingPublicCatalogPage(
      meDbId,
      catalogFilter,
      (pageNum - 1) * PAGE_SIZE,
      PAGE_SIZE,
    );
  const total = catalogPage.total;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(pageNum, 1), totalPages);
  if (total > 0 && clampedPage !== pageNum) {
    catalogPage = await listingPublicCatalogPage(
      meDbId,
      catalogFilter,
      (clampedPage - 1) * PAGE_SIZE,
      PAGE_SIZE,
    );
  }
  const listings = await hydrateSellerCards(meDbId, [...catalogPage.listings]);

  const visiblePopularTags = popularTags.slice(0, 12);

  // Saved set for current user
  let savedSet = new Set<string>();
  if (meDbId && listings.length) {
    savedSet = await ownerFavoriteListingIds(meDbId, listings.map((listing) => listing.id));
  }

  // Seller ratings for display
  const sellerIds = Array.from(new Set(listings.map((l) => l.sellerId)));
  let sellerRatings = await getSellerRatingMap(sellerIds);

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
    const featuredPage = await listingPublicCatalogPage(
      meDbId,
      { sort: "popular" },
      0,
      4,
    );
    const featured = await hydrateSellerCards(meDbId, [...featuredPage.listings]);
    const [featuredFavorites, featuredRatings] = await Promise.all([
      meDbId && featured.length > 0
        ? ownerFavoriteListingIds(meDbId, featured.map((listing) => listing.id))
        : Promise.resolve(new Set<string>()),
      getSellerRatingMap(Array.from(new Set(featured.map((listing) => listing.sellerId)))),
    ]);
    savedSet = featuredFavorites;
    sellerRatings = featuredRatings;

    return (
      <div className="bg-[#F7F5F0] min-h-[100svh]">
      <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
        <MobileFilterBar popularTags={visiblePopularTags} />
        <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
          <div className="self-start">
            <FilterSidebar popularTags={visiblePopularTags} />
          </div>
          <div className="flex-1 min-w-0 space-y-8">
            <div className="space-y-2">
              <h1 className="font-display text-2xl font-semibold">
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
                      className="rounded-full bg-[#EFEAE0] px-3 py-1 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
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
                <ul className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-4 sm:gap-x-4 sm:gap-y-8">
                  {featured.map((listing) => (
                    <GridCard key={listing.id} l={listing} />
                  ))}
                </ul>
              </div>
            )}

            <Link href="/browse" className="btn btn-secondary">
              Browse all listings
            </Link>
          </div>
        </div>
      </main>
      </div>
    );
  }

  // ── Pager component ────────────────────────────────────────────────────────
  const Pager = () => totalPages <= 1 ? null : (
    <nav className="flex items-center gap-2 text-sm">
      {clampedPage > 1 ? (
        <Link href={makePageHref(clampedPage - 1)} className="btn btn-sm btn-secondary">← Prev</Link>
      ) : (
        <span aria-disabled="true" className="btn btn-sm btn-secondary pointer-events-none opacity-45">← Prev</span>
      )}
      {totalPages > 1 && (
        <span className="px-2 text-neutral-500">
          Page <span className="font-medium">{clampedPage}</span> of {totalPages}
        </span>
      )}
      {clampedPage < totalPages ? (
        <Link href={makePageHref(clampedPage + 1)} className="btn btn-sm btn-secondary">Next →</Link>
      ) : (
        <span aria-disabled="true" className="btn btn-sm btn-secondary pointer-events-none opacity-45">Next →</span>
      )}
    </nav>
  );

  // ── Grid card renderer ─────────────────────────────────────────────────────
  function GridCard({ l }: { l: ListingWithIncludes }) {
    const shop = sellerRatings.get(l.sellerId);
    return (
      <ClickTracker listingId={l.id} flipId={l.id}>
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
              avatarImageUrl: l.seller.avatarImageUrl ?? l.seller.ownerImageUrl ?? null,
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
    const sellerName = l.seller.displayName ?? "Maker";
    const shop = sellerRatings.get(l.sellerId);
    const isInStock = l.listingType === "IN_STOCK";
    const outOfStock = l.status === "SOLD_OUT" || (isInStock && (l.stockQuantity ?? 0) <= 0);

    return (
      <div className="relative flex">
        <div className="photo-save-surface relative shrink-0 w-36 sm:w-44 aspect-[4/5] overflow-hidden bg-neutral-100">
          <Link href={publicListingPath(l.id, l.title)} className="block h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={l.photos[0]?.altText ?? l.title} src={img} loading="lazy" width={176} height={220} className="h-full w-full object-cover" />
          </Link>
          <FavoriteButton listingId={l.id} initialSaved={savedSet.has(l.id)} />
        </div>
        <div className="flex-1 min-w-0 p-4 pr-12">
          <div className="flex items-start justify-between gap-3">
            <Link href={publicListingPath(l.id, l.title)} className="font-medium hover:underline leading-snug">
              {l.title}
            </Link>
            <div className="shrink-0 font-medium">{formatCurrencyCents(l.priceCents, l.currency)}</div>
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
        </div>
      </div>
    );
  }

  // Active filters as removable chips (motion prototype): each chip links to
  // the same results without that filter; new chips pop in.
  function currentBrowseParams() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (min) p.set("min", min);
    if (max) p.set("max", max);
    if (sort !== (q ? "relevant" : "newest")) p.set("sort", sort);
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
    return p;
  }
  function browseHrefWithout(keys: string[], tag?: string) {
    const p = currentBrowseParams();
    for (const key of keys) p.delete(key);
    if (tag !== undefined) {
      const remaining = p.getAll("tag").filter((t) => t !== tag);
      p.delete("tag");
      for (const t of remaining) p.append("tag", t);
    }
    const query = p.toString();
    return query ? `/browse?${query}` : "/browse";
  }
  // Label the price chip from the amounts actually applied, not the raw URL
  // text (?min=abc applies nothing and shows no chip).
  const appliedMinLabel = boundedMinCents !== undefined
    ? formatCurrencyCents(boundedMinCents, DEFAULT_CURRENCY)
    : null;
  const appliedMaxLabel = boundedMaxCents !== undefined
    ? formatCurrencyCents(boundedMaxCents, DEFAULT_CURRENCY)
    : null;
  const priceChipLabel = appliedMinLabel && appliedMaxLabel
    ? `${appliedMinLabel}–${appliedMaxLabel}`
    : appliedMinLabel
      ? `${appliedMinLabel} and up`
      : appliedMaxLabel
        ? `Under ${appliedMaxLabel}`
        : "";
  const activeFilterChips: Array<{ key: string; label: string; href: string }> = [
    ...(categoryFilter
      ? [{ key: "category", label: CATEGORY_LABELS[categoryFilter] ?? categoryFilter, href: browseHrefWithout(["category"]) }]
      : []),
    ...(typeFilter
      ? [{ key: "type", label: typeFilter === ListingType.IN_STOCK ? "In stock" : "Made to order", href: browseHrefWithout(["type"]) }]
      : []),
    ...(shipsFilter
      ? [{ key: "ships", label: `Ships within ${shipsFilter} days`, href: browseHrefWithout(["ships"]) }]
      : []),
    ...(ratingFilter
      ? [{ key: "rating", label: `${ratingFilter}+ stars`, href: browseHrefWithout(["rating"]) }]
      : []),
    ...(hasLocationFilter
      ? [{ key: "location", label: `Within ${radiusFilter} mi`, href: browseHrefWithout(["lat", "lng", "radius"]) }]
      : []),
    ...(priceChipLabel
      ? [{ key: "price", label: priceChipLabel, href: browseHrefWithout(["min", "max"]) }]
      : []),
    ...selectedTags.map((tag) => ({
      key: `tag:${tag}`,
      label: tag.replace(/[-_]/g, " "),
      href: browseHrefWithout([], tag),
    })),
  ];
  const clearFiltersHref = browseHrefWithout(
    ["category", "type", "ships", "rating", "lat", "lng", "radius", "min", "max", "tag"],
  );

  // ── Page render ────────────────────────────────────────────────────────────
  const activeFilterCount = [
    categoryFilter, typeFilter, shipsFilter, ratingFilter, hasLocationFilter ? "loc" : null,
    priceChipLabel ? "price" : null, ...selectedTags,
  ].filter(Boolean).length;

  return (
    <div className="bg-[#F7F5F0] min-h-[100svh]">
    <main className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <MobileFilterBar popularTags={visiblePopularTags} />
      <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:items-start">
        {/* Left sidebar */}
        <div className="self-start">
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
                {/* The count rolls to the new total when filters change. */}
                <RollingNumber value={total} /> {total === 1 ? "result" : "results"}
                {activeFilterCount > 0 && (
                  <> · {activeFilterCount} filter{activeFilterCount !== 1 ? "s" : ""} active</>
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <SortMenu />
                {(Boolean(q) || activeFilterCount > 0) && (
                  <SaveSearchButton signedIn={!!userId} />
                )}
              </div>
              {/* View toggle: the white thumb slides between Grid and List
                  (the control is kept across the navigation and moves as
                  soon as it is clicked). */}
              <div className="flex flex-wrap items-center gap-2">
                <SegmentedControl
                  label="View"
                  size="sm"
                  value={view === "list" ? "list" : "grid"}
                  options={[
                    { value: "grid", label: "Grid", href: viewToggleHref("grid") },
                    { value: "list", label: "List", href: viewToggleHref("list") },
                  ]}
                />
                <Pager />
              </div>
            </div>
          </div>

          {activeFilterChips.length > 0 && (
            <div role="group" aria-label="Active filters" className="flex flex-wrap items-center gap-2">
              {activeFilterChips.map((chip) => (
                <FilterChipLink key={chip.key} href={chip.href} label={chip.label} />
              ))}
              {activeFilterChips.length > 1 && (
                <Link
                  href={clearFiltersHref}
                  className="text-[13.5px] text-neutral-600 underline underline-offset-[3px] hover:text-neutral-900"
                >
                  Clear all
                </Link>
              )}
            </div>
          )}

          {/* Listings */}
          <FlipList
            className={view === "grid"
              ? "grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-3 gap-y-6 sm:gap-x-4 sm:gap-y-8"
              : "space-y-4"}
            itemKey={`${view}:${listings.map((l) => l.id).join(",")}`}
          >
            {view === "grid"
              ? listings.map((l) => <GridCard key={l.id} l={l} />)
              : listings.map((l) => (
                  <ClickTracker key={l.id} listingId={l.id} flipId={l.id} className="card-listing">
                    <ListCard l={l} />
                  </ClickTracker>
                ))}
          </FlipList>

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
