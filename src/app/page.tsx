// src/app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import FavoriteButton from "@/components/FavoriteButton";
import MakersMapSection from "@/components/MakersMapSection";
import SearchBar from "@/components/SearchBar";
import NewsletterSignup from "@/components/NewsletterSignup";
import { ScrollSection } from "@/components/ScrollSection";

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

async function getSellerRatingMap(sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, { avg: number; count: number }>();

  const listings = await prisma.listing.findMany({
    where: { sellerId: { in: sellerIds } },
    select: { id: true, sellerId: true },
  });

  const allListingIds = listings.map((l) => l.id);
  if (allListingIds.length === 0) return new Map<string, { avg: number; count: number }>();

  const perListing = await prisma.review.groupBy({
    by: ["listingId"],
    where: { listingId: { in: allListingIds } },
    _avg: { ratingX2: true },
    _count: { _all: true },
  });

  const perListingMap = new Map<string, { avgX2: number; count: number }>();
  for (const row of perListing) {
    const count = row._count._all;
    const avgX2 = row._avg.ratingX2 ?? 0;
    if (count > 0 && avgX2 > 0) perListingMap.set(row.listingId, { avgX2, count });
  }

  const bySeller = new Map<string, string[]>();
  for (const l of listings) {
    const arr = bySeller.get(l.sellerId) ?? [];
    arr.push(l.id);
    bySeller.set(l.sellerId, arr);
  }

  const result = new Map<string, { avg: number; count: number }>();
  for (const [sellerId, ids] of bySeller.entries()) {
    let total = 0;
    let sumX2 = 0;
    for (const lid of ids) {
      const agg = perListingMap.get(lid);
      if (!agg) continue;
      total += agg.count;
      sumX2 += agg.avgX2 * agg.count;
    }
    if (total > 0) result.set(sellerId, { avg: (sumX2 / total) / 2, count: total });
  }
  return result;
}

const CATEGORIES = [
  { key: "FURNITURE", label: "Furniture", emoji: "🪑", bg: "bg-amber-100" },
  { key: "KITCHEN",   label: "Kitchen",   emoji: "🥣", bg: "bg-orange-100" },
  { key: "DECOR",     label: "Decor",     emoji: "🕯️", bg: "bg-stone-100" },
  { key: "TOOLS",     label: "Tools",     emoji: "🔨", bg: "bg-red-100" },
  { key: "TOYS",      label: "Toys",      emoji: "🧸", bg: "bg-yellow-100" },
];

export default async function HomePage() {
  const [fresh, topSaved, mapRows, trendingTagsRaw, statsResults, recentBlogPosts] = await Promise.all([
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE, isPrivate: false },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
      },
    }),
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE, isPrivate: false, favorites: { some: {} } },
      orderBy: { favorites: { _count: "desc" } },
      take: 6,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
        _count: { select: { favorites: true } },
      },
    }),
    prisma.sellerProfile.findMany({
      where: {
        publicMapOptIn: true,
        lat: { not: null },
        lng: { not: null },
        OR: [{ radiusMeters: null }, { radiusMeters: 0 }],
      },
      select: { id: true, displayName: true, city: true, state: true, lat: true, lng: true },
    }),
    prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) as count
      FROM "Listing", unnest(tags) as tag
      WHERE status = 'ACTIVE' AND "isPrivate" = false
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 5
    `,
    Promise.all([
      prisma.listing.count({ where: { status: ListingStatus.ACTIVE, isPrivate: false } }),
      prisma.sellerProfile.count({ where: { listings: { some: { status: ListingStatus.ACTIVE } } } }),
      prisma.order.count({ where: { paidAt: { not: null } } }),
    ]),
    prisma.blogPost.findMany({
      where: { status: "PUBLISHED" },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true,
        author: { select: { name: true, imageUrl: true } },
        sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
      },
    }),
  ]);

  const [activeListingsCount, sellersCount, ordersCount] = statsResults;
  const trendingTags = trendingTagsRaw.map((r) => r.tag);

  const mapPoints = mapRows
    .map((r) => ({
      id: r.id,
      name: r.displayName ?? "Maker",
      city: r.city,
      state: r.state,
      lat: Number(r.lat),
      lng: Number(r.lng),
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  let featuredMaker = await prisma.sellerProfile.findFirst({
    where: { isVerifiedMaker: true },
    include: { user: true },
  });
  if (!featuredMaker) {
    const topReviewedRows = await prisma.$queryRaw<{ sellerId: string }[]>`
      SELECT l."sellerId", COUNT(r.id) as review_count
      FROM "Listing" l
      LEFT JOIN "Review" r ON r."listingId" = l.id
      GROUP BY l."sellerId"
      ORDER BY review_count DESC
      LIMIT 1
    `;
    if (topReviewedRows.length > 0) {
      featuredMaker = await prisma.sellerProfile.findUnique({
        where: { id: topReviewedRows[0].sellerId },
        include: { user: true },
      });
    }
  }

  const { userId } = await auth();
  let saved = new Set<string>();
  if (userId && (fresh.length || topSaved.length)) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (me) {
      const ids = [...fresh.map((f) => f.id), ...topSaved.map((t) => t.id)];
      const favs = await prisma.favorite.findMany({
        where: { userId: me.id, listingId: { in: ids } },
        select: { listingId: true },
      });
      saved = new Set(favs.map((f) => f.listingId));
    }
  }

  const sellerIds = Array.from(
    new Set([
      ...fresh.map((f) => f.sellerId),
      ...topSaved.map((t) => t.sellerId),
      ...(featuredMaker ? [featuredMaker.id] : []),
    ])
  );
  const sellerRatings = await getSellerRatingMap(sellerIds);
  const featuredRating = featuredMaker ? (sellerRatings.get(featuredMaker.id) ?? null) : null;

  return (
    <main>
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen bg-gradient-to-br from-amber-50 to-stone-100 border-b flex flex-col justify-center">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center space-y-6 w-full">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-neutral-900 leading-tight">
            Handmade with heart,<br className="hidden sm:block" /> shipped from your neighborhood.
          </h1>
          <p className="text-lg text-neutral-600">
            Discover one-of-a-kind woodworking pieces from makers in your community.
          </p>

          <div className="max-w-xl mx-auto">
            <Suspense>
              <SearchBar />
            </Suspense>
          </div>

          {trendingTags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <span className="text-xs text-neutral-500 self-center">Trending:</span>
              {trendingTags.map((tag) => (
                <Link
                  key={tag}
                  href={`/browse?q=${encodeURIComponent(tag)}`}
                  className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs hover:bg-amber-50 text-neutral-700"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href="/browse"
              className="inline-flex items-center rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white hover:bg-neutral-700"
            >
              Browse the Workshop
            </Link>
            <Link
              href="/map"
              className="inline-flex items-center rounded-full border bg-white px-6 py-3 text-sm font-medium hover:bg-neutral-50"
            >
              Find Makers Near You
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce text-neutral-400">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <div className="border-b bg-white">
        <ScrollSection className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap justify-center gap-x-6 gap-y-1 text-sm text-neutral-500 text-center">
          <span><span className="font-semibold text-neutral-800">{activeListingsCount.toLocaleString()}</span> pieces listed</span>
          <span className="text-neutral-300 select-none">·</span>
          <span><span className="font-semibold text-neutral-800">{sellersCount.toLocaleString()}</span> active makers</span>
          <span className="text-neutral-300 select-none">·</span>
          <span><span className="font-semibold text-neutral-800">{ordersCount.toLocaleString()}</span> orders fulfilled</span>
        </ScrollSection>
      </div>

      {/* ── Find Makers Near You ──────────────────────────────────────────── */}
      <ScrollSection className="bg-stone-50 border-b py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold text-neutral-900">Find Makers Near You</h2>
          <p className="text-neutral-600 mt-1">Discover woodworkers in your neighborhood</p>
        </div>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <MakersMapSection
            points={mapPoints}
            heading="Explore the map"
            subheading="Pin your location to find makers nearby — or browse the full map."
          />
        </div>
      </ScrollSection>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 space-y-16">

        {/* ── Shop by Category ─────────────────────────────────────────────── */}
        <ScrollSection>
          <h2 className="text-xl font-semibold mb-5">Shop by Category</h2>
          {/* Mobile: horizontal scroll; Desktop: 6-col flex */}
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex sm:grid sm:grid-cols-6 gap-3" style={{ minWidth: 340 }}>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  href={`/browse?category=${c.key}`}
                  className={`flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center hover:shadow-sm transition-shadow flex-none w-28 sm:w-auto ${c.bg}`}
                >
                  <span className="text-3xl">{c.emoji}</span>
                  <span className="text-xs font-medium text-neutral-700">{c.label}</span>
                </Link>
              ))}
              <Link
                href="/browse"
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border p-4 text-center hover:shadow-sm transition-shadow flex-none w-28 sm:w-auto bg-neutral-50"
              >
                <span className="text-3xl">→</span>
                <span className="text-xs font-medium text-neutral-700">Browse all</span>
              </Link>
            </div>
          </div>
        </ScrollSection>

        {/* ── Meet a Maker ─────────────────────────────────────────────────── */}
        {featuredMaker && (
          <ScrollSection>
            <div className="mb-5 space-y-0.5">
              <h2 className="text-xl font-semibold">Meet a Maker</h2>
              <p className="text-sm text-neutral-500">The people behind the pieces</p>
            </div>

            <div className="rounded-3xl border bg-gradient-to-br from-amber-50 to-stone-50 overflow-hidden">
              {featuredMaker.bannerImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={featuredMaker.bannerImageUrl} alt="" className="h-36 w-full object-cover" />
              )}
              <div className="p-6 sm:p-8 flex flex-col sm:flex-row gap-6 items-start">
                <div className="shrink-0">
                  {(featuredMaker.avatarImageUrl ?? featuredMaker.user?.imageUrl) ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(featuredMaker.avatarImageUrl ?? featuredMaker.user?.imageUrl)!}
                      alt={featuredMaker.displayName ?? ""}
                      className="h-20 w-20 rounded-full border-2 border-white shadow object-cover"
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-200 text-2xl font-bold text-amber-800 border-2 border-white shadow">
                      {(featuredMaker.displayName || "M")[0]?.toUpperCase()}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold">{featuredMaker.displayName}</span>
                    {featuredMaker.isVerifiedMaker && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
                        ✓ Verified Maker
                      </span>
                    )}
                  </div>

                  {featuredMaker.tagline && (
                    <p className="text-sm text-neutral-600 italic">&ldquo;{featuredMaker.tagline}&rdquo;</p>
                  )}

                  {(featuredMaker.city || featuredMaker.state) && (
                    <p className="text-xs text-neutral-500">
                      📍 {[featuredMaker.city, featuredMaker.state].filter(Boolean).join(", ")}
                    </p>
                  )}

                  {featuredRating && featuredRating.count > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-neutral-600">
                      <StarsInline value={featuredRating.avg} />
                      <span>{(Math.round(featuredRating.avg * 10) / 10).toFixed(1)}</span>
                      <span className="text-neutral-400">({featuredRating.count} reviews)</span>
                    </div>
                  )}

                  {featuredMaker.bio && (
                    <p className="text-sm text-neutral-600 line-clamp-2">
                      {featuredMaker.bio.slice(0, 150)}{featuredMaker.bio.length > 150 ? "…" : ""}
                    </p>
                  )}

                  <div className="pt-1">
                    <Link
                      href={`/seller/${featuredMaker.id}`}
                      className="inline-flex items-center rounded-full bg-neutral-900 px-4 py-1.5 text-xs font-medium text-white hover:bg-neutral-700"
                    >
                      Visit Their Workshop →
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </ScrollSection>
        )}

        {/* ── Fresh from the Workshop ───────────────────────────────────────── */}
        <ScrollSection>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Fresh from the Workshop 🪵</h2>
            <Link href="/browse" className="text-sm text-neutral-600 hover:underline">Browse all</Link>
          </div>

          {fresh.length === 0 ? (
            <div className="rounded-xl border bg-white p-6 text-neutral-600">
              Nothing listed yet — check back soon.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
              <ul className="flex gap-4 snap-x snap-mandatory pb-3" style={{ width: "max-content" }}>
                {fresh.map((l) => {
                  const img = l.photos[0]?.url ?? "/favicon.ico";
                  const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Maker";
                  const sellerHref = `/seller/${l.sellerId}`;
                  const sellerAvatar = l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null;
                  const initials = (sellerName || "M").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "M";
                  const shop = sellerRatings.get(l.sellerId);

                  return (
                    <li key={l.id} className="snap-start flex-none w-56 overflow-hidden border border-neutral-200 bg-white">
                      <div className="relative">
                        <Link href={`/listing/${l.id}`} className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={l.title} src={img} className="h-44 w-full object-cover" />
                        </Link>
                        <div className="absolute top-2 right-2">
                          <FavoriteButton listingId={l.id} initialSaved={saved.has(l.id)} />
                        </div>
                      </div>
                      <Link href={`/listing/${l.id}`} className="block">
                        <div className="p-3 space-y-1 bg-stone-50">
                          <div className="font-medium text-sm leading-snug line-clamp-2">{l.title}</div>
                          <div className="text-sm text-neutral-500">${(l.priceCents / 100).toFixed(2)}</div>
                          {shop && shop.count > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                              <StarsInline value={shop.avg} />
                              <span>{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                      </Link>
                      <div className="px-3 pb-3 bg-stone-50">
                        <Link href={sellerHref} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs hover:bg-neutral-50">
                          {sellerAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sellerAvatar} alt={sellerName} className="h-4 w-4 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-200">
                              <span className="text-[9px] font-medium text-neutral-700">{initials}</span>
                            </div>
                          )}
                          <span className="truncate max-w-[80px]">{sellerName}</span>
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </ScrollSection>

        {/* ── Collector Favorites ───────────────────────────────────────────── */}
        {topSaved.length > 0 && (
          <ScrollSection>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Collector Favorites ❤️</h2>
            </div>

            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
              <ul className="flex gap-4 snap-x snap-mandatory pb-3" style={{ width: "max-content" }}>
                {topSaved.map((l) => {
                  const img = l.photos[0]?.url ?? "/favicon.ico";
                  const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Maker";
                  const sellerHref = `/seller/${l.sellerId}`;
                  const sellerAvatar = l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null;
                  const initials = (sellerName || "M").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "M";
                  const shop = sellerRatings.get(l.sellerId);

                  return (
                    <li key={l.id} className="snap-start flex-none w-56 overflow-hidden border border-neutral-200 bg-white">
                      <div className="relative">
                        <Link href={`/listing/${l.id}`} className="block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img alt={l.title} src={img} className="h-44 w-full object-cover" />
                        </Link>
                        <div className="absolute top-2 right-2">
                          <FavoriteButton listingId={l.id} initialSaved={saved.has(l.id)} />
                        </div>
                      </div>
                      <Link href={`/listing/${l.id}`} className="block">
                        <div className="p-3 space-y-1 bg-stone-50">
                          <div className="font-medium text-sm leading-snug line-clamp-2">{l.title}</div>
                          <div className="text-sm text-neutral-500">${(l.priceCents / 100).toFixed(2)}</div>
                          {shop && shop.count > 0 && (
                            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                              <StarsInline value={shop.avg} />
                              <span>{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
                            </div>
                          )}
                          <div className="text-xs text-neutral-400">{l._count.favorites} saved</div>
                        </div>
                      </Link>
                      <div className="px-3 pb-3 bg-stone-50">
                        <Link href={sellerHref} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs hover:bg-neutral-50">
                          {sellerAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={sellerAvatar} alt={sellerName} className="h-4 w-4 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-200">
                              <span className="text-[9px] font-medium text-neutral-700">{initials}</span>
                            </div>
                          )}
                          <span className="truncate max-w-[80px]">{sellerName}</span>
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </ScrollSection>
        )}

        {/* ── Stories from the Workshop ────────────────────────────────────── */}
        {recentBlogPosts.length > 0 && (
          <ScrollSection>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold">Stories from the Workshop</h2>
              <Link href="/blog" className="text-sm text-neutral-600 hover:underline">
                Read more stories
              </Link>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {recentBlogPosts.map((p) => {
                const authorName = p.sellerProfile?.displayName ?? p.author.name ?? "Staff";
                const authorAvatar = p.sellerProfile?.avatarImageUrl ?? p.author.imageUrl;
                return (
                  <li key={p.slug} className="border border-neutral-200 overflow-hidden hover:shadow-sm transition-shadow">
                    <Link href={`/blog/${p.slug}`} className="block">
                      <div className="h-44 bg-neutral-100 overflow-hidden">
                        {p.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-4 space-y-2">
                        <h3 className="font-semibold text-neutral-900 line-clamp-2">{p.title}</h3>
                        {p.excerpt && (
                          <p className="text-sm text-neutral-500 line-clamp-2">{p.excerpt.slice(0, 100)}</p>
                        )}
                        <div className="flex items-center gap-1.5">
                          {authorAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={authorAvatar} alt={authorName} className="h-5 w-5 rounded-full object-cover" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-neutral-200" />
                          )}
                          <span className="text-xs text-neutral-500">{authorName}</span>
                          {p.publishedAt && (
                            <span className="text-xs text-neutral-400 ml-auto">
                              {new Date(p.publishedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </ScrollSection>
        )}
      </div>

      {/* ── Newsletter ───────────────────────────────────────────────────── */}
      <ScrollSection className="border-t bg-amber-50">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-16">
          <NewsletterSignup
            heading="Get workshop stories in your inbox"
            subheading="Maker spotlights, build guides, and new pieces — straight to you."
          />
        </div>
      </ScrollSection>
    </main>
  );
}
