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
import GuildBadge from "@/components/GuildBadge";
import { Armchair, Utensils, Candle, Toy, Box, Gift, TreePine, Palette } from "@/components/icons";
import ClickTracker from "@/components/ClickTracker";
import HeroMosaic from "@/components/HeroMosaic";
import ListingCard from "@/components/ListingCard";

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
  { key: "FURNITURE", label: "Furniture",     Icon: Armchair  },
  { key: "KITCHEN",   label: "Kitchen",       Icon: Utensils  },
  { key: "DECOR",     label: "Decor",         Icon: Candle    },
  { key: "TOOLS",     label: "Home & Office", Icon: Box       },
  { key: "TOYS",      label: "Toys",          Icon: Toy       },
  { key: "ART",       label: "Art",           Icon: Palette   },
  { key: "OUTDOOR",   label: "Outdoor",       Icon: TreePine  },
  { key: "STORAGE",   label: "Gifts",         Icon: Gift      },
];

export default async function HomePage() {
  const [fresh, topSaved, mapRows, trendingTagsRaw, statsResults, recentBlogPosts, mosaicListings] = await Promise.all([
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE, isPrivate: false, seller: { vacationMode: false, chargesEnabled: true, user: { banned: false } } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
      },
    }),
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE, isPrivate: false, favorites: { some: {} }, seller: { vacationMode: false, chargesEnabled: true, user: { banned: false } } },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
        _count: { select: { favorites: true } },
      },
    }),
    prisma.sellerProfile.findMany({
      where: {
        publicMapOptIn: true,
        chargesEnabled: true,
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
    prisma.listing.findMany({
      where: { status: "ACTIVE", isPrivate: false },
      orderBy: { createdAt: "desc" },
      take: 16,
      select: {
        id: true,
        photos: {
          take: 1,
          orderBy: { sortOrder: "asc" },
          select: { url: true },
        },
      },
    }),
  ]);

  const [activeListingsCount, sellersCount, ordersCount] = statsResults;
  const trendingTags = trendingTagsRaw.map((r) => r.tag);

  const mosaicPhotos: { url: string; listingId: string }[] = mosaicListings
    .filter(l => l.photos.length > 0)
    .map(l => ({ url: l.photos[0].url, listingId: l.id }))
    .filter(item => item.url.includes("cdn.thegrainline.com"));

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

  // Manual override: any seller with isVerifiedMaker = true shown first
  let featuredMaker = await prisma.sellerProfile.findFirst({
    where: { isVerifiedMaker: true, chargesEnabled: true, vacationMode: false, user: { banned: false } },
    include: { user: true },
  });

  if (!featuredMaker) {
    // Weekly rotation among Guild Members and Masters (deterministic — same for all visitors in same week)
    const guildSellers = await prisma.sellerProfile.findMany({
      where: { guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] }, chargesEnabled: true, vacationMode: false, user: { banned: false } },
      orderBy: { id: "asc" },
      include: { user: true },
    });

    if (guildSellers.length > 0) {
      const weekNumber = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
      featuredMaker = guildSellers[weekNumber % guildSellers.length];
    }
  }

  if (!featuredMaker) {
    // Fall back to most-reviewed seller
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
  type FromYourMakersItem =
    | { kind: "listing"; id: string; title: string; priceCents: number; currency: string; photoUrl: string | null; sellerName: string; sellerProfileId: string }
    | { kind: "blog"; slug: string; title: string; coverImageUrl: string | null; sellerName: string; sellerProfileId: string };
  let fromYourMakers: FromYourMakersItem[] = [];

  if (userId) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (me) {
      const ids = [...fresh.map((f) => f.id), ...topSaved.map((t) => t.id)];
      const [favs, follows] = await Promise.all([
        prisma.favorite.findMany({
          where: { userId: me.id, listingId: { in: ids } },
          select: { listingId: true },
        }),
        prisma.follow.findMany({
          where: { followerId: me.id },
          select: { sellerProfileId: true },
          take: 50,
        }),
      ]);
      saved = new Set(favs.map((f) => f.listingId));

      if (follows.length >= 3) {
        const followedIds = follows.map((f) => f.sellerProfileId);
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [recentListings, recentPosts] = await Promise.all([
          prisma.listing.findMany({
            where: { sellerId: { in: followedIds }, status: "ACTIVE", isPrivate: false, createdAt: { gte: cutoff } },
            orderBy: { createdAt: "desc" },
            take: 6,
            select: {
              id: true, title: true, priceCents: true, currency: true, createdAt: true, sellerId: true,
              seller: { select: { displayName: true } },
              photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
            },
          }),
          prisma.blogPost.findMany({
            where: { sellerProfileId: { in: followedIds }, status: "PUBLISHED", publishedAt: { gte: cutoff } },
            orderBy: { publishedAt: "desc" },
            take: 6,
            select: {
              slug: true, title: true, coverImageUrl: true, publishedAt: true, sellerProfileId: true,
              sellerProfile: { select: { displayName: true } },
            },
          }),
        ]);

        const merged: FromYourMakersItem[] = [
          ...recentListings.map((l): FromYourMakersItem => ({
            kind: "listing", id: l.id, title: l.title, priceCents: l.priceCents, currency: l.currency,
            photoUrl: l.photos[0]?.url ?? null,
            sellerName: l.seller.displayName ?? "Maker",
            sellerProfileId: l.sellerId,
          })),
          ...recentPosts.map((p): FromYourMakersItem => ({
            kind: "blog", slug: p.slug, title: p.title, coverImageUrl: p.coverImageUrl,
            sellerName: p.sellerProfile?.displayName ?? "Maker",
            sellerProfileId: p.sellerProfileId ?? "",
          })),
        ];
        // Sort by recency (listings by createdAt, posts by publishedAt - both are within cutoff)
        fromYourMakers = merged.slice(0, 6);
      }
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
      <section className={`relative border-b flex flex-col justify-center min-h-[60vh] ${
        mosaicPhotos.length >= 12
          ? "bg-[#1C1C1A]"
          : "bg-gradient-to-br from-amber-100 via-amber-50 to-stone-50"
      }`}>
        {mosaicPhotos.length >= 12 && <HeroMosaic photos={mosaicPhotos} />}
        <div className="relative z-20 max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center space-y-6 w-full">
          <h1 className={`text-display font-display ${mosaicPhotos.length >= 12 ? "text-white" : "text-neutral-900"}`}>
            The Woodworking Marketplace
          </h1>
          <p className={`text-lg ${mosaicPhotos.length >= 12 ? "text-white/80" : "text-stone-500"}`}>
            Discover handmade pieces from local makers across the country.
          </p>

          <div className="max-w-xl mx-auto [&_input]:bg-white/20 [&_input]:backdrop-blur-sm [&_input]:border-white/30 [&_input]:text-white [&_input]:placeholder-white/60">
            <Suspense>
              <SearchBar variant={mosaicPhotos.length >= 12 ? "glass" : "default"} />
            </Suspense>
          </div>

          {trendingTags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <span className={`text-xs self-center ${mosaicPhotos.length >= 12 ? "text-white/60" : "text-neutral-500"}`}>Trending:</span>
              {trendingTags.map((tag) => (
                <Link
                  key={tag}
                  href={`/browse?q=${encodeURIComponent(tag)}`}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    mosaicPhotos.length >= 12
                      ? "border-white/40 bg-white/10 text-white hover:bg-white/20"
                      : "border-amber-200 bg-white text-neutral-700 hover:bg-amber-50"
                  }`}
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href="/browse"
              className="inline-flex items-center rounded-full bg-[#2C1F1A] px-6 py-3 text-sm font-medium text-white hover:bg-[#3A2A24]"
            >
              Browse the Workshop
            </Link>
            <Link
              href="/map"
              className={`inline-flex items-center rounded-full border-2 px-6 py-3 text-sm font-medium transition-colors ${
                mosaicPhotos.length >= 12
                  ? "border-white text-white hover:bg-white hover:text-neutral-900"
                  : "border-[#2C1F1A] bg-transparent text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white"
              }`}
            >
              Find Makers Near You
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce ${mosaicPhotos.length >= 12 ? "text-white/60" : "text-neutral-400"}`}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <div className="border-b bg-amber-50">
        <ScrollSection className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap justify-center gap-x-8 gap-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{activeListingsCount.toLocaleString()}</span>
            <span className="text-sm text-stone-500">pieces listed</span>
          </div>
          <span className="text-amber-300 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{sellersCount.toLocaleString()}</span>
            <span className="text-sm text-stone-500">active makers</span>
          </div>
          <span className="text-amber-300 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{ordersCount.toLocaleString()}</span>
            <span className="text-sm text-stone-500">orders fulfilled</span>
          </div>
        </ScrollSection>
      </div>

      {/* ── Find Makers Near You ──────────────────────────────────────────── */}
      <ScrollSection className="bg-amber-50/40 border-b py-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold font-display text-neutral-900">Find Makers Near You</h2>
          <p className="text-neutral-600 mt-1">Discover woodworkers in your neighborhood</p>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <MakersMapSection
            points={mapPoints}
            heading="Explore the map"
            subheading="Pin your location to find makers nearby — or browse the full map."
            headingClassName="font-display"
          />
        </div>
      </ScrollSection>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-amber-50/20 via-white to-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-12 space-y-10">

        {/* ── From Your Makers ─────────────────────────────────────────────── */}
        {fromYourMakers.length > 0 && (
          <ScrollSection>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">From Your Makers</h2>
              <Link href="/account/feed" className="text-sm text-neutral-600 hover:underline">
                See full feed →
              </Link>
            </div>
            <ul className="flex overflow-x-auto snap-x snap-mandatory gap-4 pb-0 -mx-1 px-1 scroll-fade-edges">
              {fromYourMakers.map((item) => (
                item.kind === "listing" ? (
                  <ClickTracker key={item.id} listingId={item.id} className="w-44 flex-none snap-start card-listing">
                    <Link href={`/listing/${item.id}`} className="block">
                      <div className="h-36 bg-neutral-100 overflow-hidden">
                        {item.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.photoUrl} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-2 bg-white">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-neutral-500">
                          {(item.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: item.currency })}
                        </p>
                        <p className="text-xs text-neutral-400 truncate">{item.sellerName}</p>
                      </div>
                    </Link>
                  </ClickTracker>
                ) : (
                  <li key={item.slug} className="w-44 flex-none snap-start card-listing">
                    <Link href={`/blog/${item.slug}`} className="block">
                      <div className="h-36 bg-neutral-100 overflow-hidden">
                        {item.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.coverImageUrl} alt={item.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-2 bg-white">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-amber-600">Blog post</p>
                        <p className="text-xs text-neutral-400 truncate">{item.sellerName}</p>
                      </div>
                    </Link>
                  </li>
                )
              ))}
            </ul>
          </ScrollSection>
        )}

        {/* ── Shop by Category ─────────────────────────────────────────────── */}
        <ScrollSection>
          <h2 className="text-xl font-semibold font-display mb-5">Shop by Category</h2>
          {/* Mobile: horizontal scroll; Desktop: 6-col flex */}
          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex sm:grid sm:grid-cols-9 gap-3" style={{ minWidth: 480 }}>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  href={`/browse?category=${c.key}`}
                  className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-amber-100 p-4 text-center hover:bg-amber-100 hover:shadow-md hover:shadow-amber-100/50 transition-all flex-none w-28 sm:w-auto bg-amber-50"
                >
                  <c.Icon size={28} className="text-amber-700" />
                  <span className="text-xs font-medium text-neutral-800">{c.label}</span>
                </Link>
              ))}
              <Link
                href="/browse"
                className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-amber-200 p-4 text-center hover:bg-amber-100 hover:shadow-md transition-all flex-none w-28 sm:w-auto bg-amber-50/50"
              >
                <span className="text-3xl">→</span>
                <span className="text-xs font-medium text-neutral-700">Browse all</span>
              </Link>
            </div>
          </div>
        </ScrollSection>

        {/* ── Meet a Maker ─────────────────────────────────────────────────── */}
        {featuredMaker && (
          <ScrollSection className="bg-amber-50/60 rounded-xl px-4 py-6 -mx-4 border border-amber-100">
            <div className="mb-5 space-y-0.5">
              <h2 className="text-xl font-semibold font-display">Meet a Maker</h2>
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
                    <GuildBadge level={featuredMaker.guildLevel as import("@/components/GuildBadge").GuildLevelValue} showLabel={true} size={18} />
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
            <h2 className="text-xl font-semibold font-display">Fresh from the Workshop</h2>
            <Link href="/browse" className="text-sm text-neutral-600 hover:underline">Browse all</Link>
          </div>

          {fresh.length === 0 ? (
            <div className="rounded-xl border bg-white p-6 text-neutral-600">
              Nothing listed yet — check back soon.
            </div>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0 scroll-fade-edges">
              <ul className="flex gap-4 snap-x snap-mandatory pb-0" style={{ width: "max-content" }}>
                {fresh.map((l) => {
                  const shop = sellerRatings.get(l.sellerId);
                  return (
                    <ClickTracker key={l.id} listingId={l.id} className="snap-start flex-none w-56">
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
                          secondPhotoUrl: l.photos[1]?.url ?? null,
                          seller: {
                            id: l.sellerId,
                            displayName: l.seller.displayName ?? null,
                            avatarImageUrl: l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null,
                            guildLevel: l.seller.guildLevel ?? null,
                            city: l.seller.city ?? null,
                            state: l.seller.state ?? null,
                            acceptingNewOrders: l.seller.acceptingNewOrders ?? null,
                          },
                          rating: (() => {
                            const s = sellerRatings.get(l.sellerId);
                            return s && s.count > 0 ? { avg: s.avg, count: s.count } : null;
                          })(),
                        }}
                        initialSaved={saved.has(l.id)}
                        variant="scroll"
                      />
                    </ClickTracker>
                  );
                })}
              </ul>
            </div>
          )}
        </ScrollSection>

        {/* ── Buyer Favorites ───────────────────────────────────────────── */}
        {topSaved.length > 0 && (
          <ScrollSection>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">Buyer Favorites</h2>
            </div>

            <div className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0 scroll-fade-edges">
              <ul className="flex gap-4 snap-x snap-mandatory pb-0" style={{ width: "max-content" }}>
                {topSaved.map((l) => {
                  return (
                    <ClickTracker key={l.id} listingId={l.id} className="snap-start flex-none w-56">
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
                          secondPhotoUrl: l.photos[1]?.url ?? null,
                          seller: {
                            id: l.sellerId,
                            displayName: l.seller.displayName ?? null,
                            avatarImageUrl: l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null,
                            guildLevel: l.seller.guildLevel ?? null,
                            city: l.seller.city ?? null,
                            state: l.seller.state ?? null,
                            acceptingNewOrders: l.seller.acceptingNewOrders ?? null,
                          },
                          rating: (() => {
                            const s = sellerRatings.get(l.sellerId);
                            return s && s.count > 0 ? { avg: s.avg, count: s.count } : null;
                          })(),
                        }}
                        initialSaved={saved.has(l.id)}
                        variant="scroll"
                      />
                    </ClickTracker>
                  );
                })}
              </ul>
            </div>
          </ScrollSection>
        )}

        {/* ── Stories from the Workshop ────────────────────────────────────── */}
        {recentBlogPosts.length > 0 && (
          <ScrollSection className="bg-amber-50/30 rounded-xl px-4 py-6 -mx-4">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">Stories from the Workshop</h2>
              <Link href="/blog" className="text-sm text-neutral-600 hover:underline">
                Read more stories
              </Link>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {recentBlogPosts.map((p) => {
                const authorName = p.sellerProfile?.displayName ?? p.author.name ?? "Staff";
                const authorAvatar = p.sellerProfile?.avatarImageUrl ?? p.author.imageUrl;
                return (
                  <li key={p.slug} className="card-listing">
                    <Link href={`/blog/${p.slug}`} className="block">
                      <div className="aspect-[4/3] bg-stone-100 overflow-hidden">
                        {p.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-4 space-y-2 bg-white">
                        <h3 className="font-medium text-sm text-neutral-900 line-clamp-2">{p.title}</h3>
                        {p.excerpt && (
                          <p className="text-xs text-stone-500 line-clamp-2">{p.excerpt.slice(0, 100)}</p>
                        )}
                        <div className="flex items-center gap-1.5">
                          {authorAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={authorAvatar} alt={authorName} className="h-5 w-5 rounded-full object-cover" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-neutral-200" />
                          )}
                          <span className="text-xs text-stone-500">{authorName}</span>
                          {p.publishedAt && (
                            <span className="text-xs text-stone-400 ml-auto">
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
