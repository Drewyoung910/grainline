// src/app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ListingStatus, Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";
import MakersMapSection from "@/components/MakersMapSection";
import SearchBar from "@/components/SearchBar";
import NewsletterSignup from "@/components/NewsletterSignup";
import { ScrollSection } from "@/components/ScrollSection";
import GuildBadge from "@/components/GuildBadge";
import { Armchair, Utensils, Candle, Toy, Box, Gift, TreePine, Palette, MapPin } from "@/components/icons";
import ClickTracker from "@/components/ClickTracker";
import HeroMosaic from "@/components/HeroMosaic";
import ListingCard from "@/components/ListingCard";
import SaveBlogButton from "@/components/SaveBlogButton";
import { getBlockedIdsFor } from "@/lib/blocks";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import { safeJsonLd } from "@/lib/json-ld";
import { publicListingWhere } from "@/lib/listingVisibility";

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

const featuredMakerInclude = {
  user: { select: { imageUrl: true } },
} satisfies Prisma.SellerProfileInclude;

type FeaturedMaker = Prisma.SellerProfileGetPayload<{ include: typeof featuredMakerInclude }>;

const featuredMakerWhere = {
  chargesEnabled: true,
  vacationMode: false,
  user: { banned: false, deletedAt: null },
} satisfies Prisma.SellerProfileWhereInput;

async function getSellerRatingMap(sellerIds: string[]) {
  if (sellerIds.length === 0) return new Map<string, { avg: number; count: number }>();

  const rows = await prisma.$queryRaw<Array<{ sellerId: string; avgX2: number | null; count: bigint }>>`
    SELECT l."sellerId", AVG(r."ratingX2")::float AS "avgX2", COUNT(*) AS count
    FROM "Review" r
    INNER JOIN "Listing" l ON l.id = r."listingId"
    WHERE l."sellerId" IN (${Prisma.join(sellerIds)})
    GROUP BY l."sellerId"
  `;
  const result = new Map<string, { avg: number; count: number }>();
  for (const row of rows) {
    const count = Number(row.count);
    if (count > 0 && row.avgX2) result.set(row.sellerId, { avg: row.avgX2 / 2, count });
  }
  return result;
}

function makerWeekIndex(count: number) {
  if (count <= 0) return 0;
  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon ... 6=Sat
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + daysToMonday);
  monday.setUTCHours(0, 0, 0, 0);
  return Math.floor(monday.getTime() / (7 * 24 * 60 * 60 * 1000)) % count;
}

async function getFeaturedMaker(): Promise<FeaturedMaker | null> {
  const now = new Date();
  const curated = await prisma.sellerProfile.findFirst({
    where: {
      ...featuredMakerWhere,
      featuredUntil: { gt: now },
    },
    include: featuredMakerInclude,
  });
  if (curated) return curated;

  const guildWhere = {
    ...featuredMakerWhere,
    guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] },
  } satisfies Prisma.SellerProfileWhereInput;
  const guildCount = await prisma.sellerProfile.count({ where: guildWhere });
  if (guildCount > 0) {
    const weekly = await prisma.sellerProfile.findFirst({
      where: guildWhere,
      orderBy: { id: "asc" },
      skip: makerWeekIndex(guildCount),
      include: featuredMakerInclude,
    });
    if (weekly) return weekly;
  }

  const topReviewedRows = await prisma.$queryRaw<{ sellerId: string }[]>`
    SELECT l."sellerId", COUNT(r.id) as review_count
    FROM "Listing" l
    JOIN "SellerProfile" sp ON sp.id = l."sellerId"
    JOIN "User" u ON u.id = sp."userId"
    LEFT JOIN "Review" r ON r."listingId" = l.id
    WHERE sp."chargesEnabled" = true
      AND sp."vacationMode" = false
      AND u.banned = false
      AND u."deletedAt" IS NULL
      AND l.status = 'ACTIVE'
      AND l."isPrivate" = false
    GROUP BY l."sellerId"
    ORDER BY review_count DESC
    LIMIT 1
  `;
  const topSellerId = topReviewedRows[0]?.sellerId;
  if (!topSellerId) return null;

  return prisma.sellerProfile.findFirst({
    where: { ...featuredMakerWhere, id: topSellerId },
    include: featuredMakerInclude,
  });
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
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const meRow = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meDbId = meRow?.id ?? null;
  }
  const { blockedUserIds, blockedSellerIds } = await getBlockedIdsFor(meDbId);

  const [fresh, topSaved, mapRows, trendingTagsRaw, statsResults, recentBlogPosts, mosaicListings] = await Promise.all([
    // New Arrivals: prefer last 30 days, fall back to newest if fewer than 6
    prisma.listing.findMany({
      where: {
        status: ListingStatus.ACTIVE, isPrivate: false,
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
        seller: { vacationMode: false, chargesEnabled: true, user: { banned: false, deletedAt: null } },
        ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: {
        photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: {
          select: {
            displayName: true,
            avatarImageUrl: true,
            guildLevel: true,
            city: true,
            state: true,
            acceptingNewOrders: true,
            user: { select: { imageUrl: true } },
          },
        },
      },
    }).then(async (results) => {
      if (results.length >= 6) return results;
      // Fall back to newest without date filter
      return prisma.listing.findMany({
        where: {
          status: ListingStatus.ACTIVE, isPrivate: false,
          seller: { vacationMode: false, chargesEnabled: true, user: { banned: false, deletedAt: null } },
          ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 6,
        include: {
          photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true } },
          seller: {
            select: {
              displayName: true,
              avatarImageUrl: true,
              guildLevel: true,
              city: true,
              state: true,
              acceptingNewOrders: true,
              user: { select: { imageUrl: true } },
            },
          },
        },
      });
    }),
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE, isPrivate: false, qualityScore: { gt: 0 }, seller: { vacationMode: false, chargesEnabled: true, user: { banned: false, deletedAt: null } }, ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}) },
      orderBy: { qualityScore: "desc" },
      take: 6,
      include: {
        photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: {
          select: {
            displayName: true,
            avatarImageUrl: true,
            guildLevel: true,
            city: true,
            state: true,
            acceptingNewOrders: true,
            user: { select: { imageUrl: true } },
          },
        },
        _count: { select: { favorites: true } },
      },
    }),
    prisma.sellerProfile.findMany({
      where: {
        publicMapOptIn: true,
        chargesEnabled: true,
        user: { banned: false, deletedAt: null },
        lat: { not: null },
        lng: { not: null },
        OR: [{ radiusMeters: null }, { radiusMeters: 0 }],
        ...(blockedSellerIds.length > 0 ? { id: { notIn: blockedSellerIds } } : {}),
      },
      select: { id: true, displayName: true, city: true, state: true, lat: true, lng: true },
      take: 200,
    }),
    prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) as count
      FROM "Listing" l
      INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
      INNER JOIN "User" u ON u.id = sp."userId",
      unnest(l.tags) as tag
      WHERE l.status = 'ACTIVE'
        AND l."isPrivate" = false
        AND sp."chargesEnabled" = true
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
      GROUP BY tag
      ORDER BY count DESC
      LIMIT 5
    `,
    Promise.all([
      prisma.listing.count({ where: publicListingWhere() }),
      prisma.sellerProfile.count({ where: { chargesEnabled: true, vacationMode: false, user: { banned: false, deletedAt: null }, listings: { some: { status: ListingStatus.ACTIVE, isPrivate: false } } } }),
      prisma.order.count({ where: { paidAt: { not: null } } }),
      prisma.user.count({ where: { banned: false, deletedAt: null } }),
    ]),
    prisma.blogPost.findMany({
      where: {
        status: "PUBLISHED",
        author: { banned: false, deletedAt: null },
        ...(blockedUserIds.size > 0 ? { authorId: { notIn: [...blockedUserIds] } } : {}),
      },
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: {
        id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true,
        author: { select: { name: true, imageUrl: true } },
        sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
      },
    }),
    prisma.listing.findMany({
      where: publicListingWhere(),
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

  const [activeListingsCount, sellersCount, ordersCount, membersCount] = statsResults;
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

  const featuredMaker = await getFeaturedMaker();

  // Resolve featured listings: prefer curated, fall back to most recently updated (up to 3)
  type FeaturedListing = { id: string; title: string; priceCents: number; photos: { url: string }[] };
  let featuredListings: FeaturedListing[] = [];
  if (featuredMaker) {
    const listingSelect = { id: true, title: true, priceCents: true, photos: { take: 1, orderBy: { sortOrder: "asc" as const }, select: { url: true } } };
    if (featuredMaker.featuredListingIds.length > 0) {
      const curated = await prisma.listing.findMany({
        where: { id: { in: featuredMaker.featuredListingIds }, sellerId: featuredMaker.id, status: "ACTIVE", isPrivate: false, photos: { some: {} } },
        select: listingSelect,
        take: 3,
      });
      featuredListings = curated;
    }
    if (featuredListings.length < 3) {
      const existingIds = featuredListings.map((l) => l.id);
      const more = await prisma.listing.findMany({
        where: { sellerId: featuredMaker.id, status: "ACTIVE", isPrivate: false, photos: { some: {} }, ...(existingIds.length > 0 ? { id: { notIn: existingIds } } : {}) },
        orderBy: { updatedAt: "desc" },
        select: listingSelect,
        take: 3 - featuredListings.length,
      });
      featuredListings = [...featuredListings, ...more];
    }
  }

  let saved = new Set<string>();
  let savedBlogSlugs = new Set<string>();
  type FromYourMakersItem =
    | { kind: "listing"; id: string; title: string; priceCents: number; currency: string; photoUrl: string | null; sellerName: string; sellerProfileId: string }
    | { kind: "blog"; slug: string; title: string; coverImageUrl: string | null; sellerName: string; sellerProfileId: string };
  let fromYourMakers: FromYourMakersItem[] = [];

  if (meDbId) {
    const ids = [...fresh.map((f) => f.id), ...topSaved.map((t) => t.id)];
    const blogPostIds = recentBlogPosts.map((p) => p.id);
    const [favs, follows, savedBlogRows] = await Promise.all([
      prisma.favorite.findMany({
        where: { userId: meDbId, listingId: { in: ids } },
        select: { listingId: true },
      }),
      prisma.follow.findMany({
        where: { followerId: meDbId },
        select: { sellerProfileId: true },
        take: 50,
      }),
      blogPostIds.length > 0
        ? prisma.savedBlogPost.findMany({
            where: { userId: meDbId, blogPostId: { in: blogPostIds } },
            select: { blogPostId: true },
          })
        : Promise.resolve([]),
    ]);
    saved = new Set(favs.map((f) => f.listingId));
    const savedBlogIdSet = new Set(savedBlogRows.map((s) => s.blogPostId));
    savedBlogSlugs = new Set(
      recentBlogPosts.filter((p) => savedBlogIdSet.has(p.id)).map((p) => p.slug)
    );

    if (follows.length >= 3) {
      const followedIds = follows.map((f) => f.sellerProfileId);
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const [recentListings, recentPosts] = await Promise.all([
        prisma.listing.findMany({
          where: { sellerId: { in: followedIds, ...(blockedSellerIds.length > 0 ? { notIn: blockedSellerIds } : {}) }, status: "ACTIVE", isPrivate: false, createdAt: { gte: cutoff }, seller: { chargesEnabled: true, vacationMode: false, user: { banned: false, deletedAt: null } } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true, title: true, priceCents: true, currency: true, createdAt: true, sellerId: true,
            seller: { select: { displayName: true } },
            photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
          },
        }),
        prisma.blogPost.findMany({
          where: { sellerProfileId: { in: followedIds, ...(blockedSellerIds.length > 0 ? { notIn: blockedSellerIds } : {}) }, status: "PUBLISHED", publishedAt: { gte: cutoff }, author: { banned: false, deletedAt: null }, sellerProfile: { chargesEnabled: true, vacationMode: false, user: { banned: false, deletedAt: null } } },
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

  const sellerIds = Array.from(
    new Set([
      ...fresh.map((f) => f.sellerId),
      ...topSaved.map((t) => t.sellerId),
      ...(featuredMaker ? [featuredMaker.id] : []),
    ])
  );
  const sellerRatings = await getSellerRatingMap(sellerIds);
  const featuredRating = featuredMaker ? (sellerRatings.get(featuredMaker.id) ?? null) : null;

  // Maker of the Week pill dates — aligned to Monday–Sunday calendar week
  const nowForPill = new Date();
  const dowForPill = nowForPill.getUTCDay();
  const daysToMondayForPill = dowForPill === 0 ? -6 : 1 - dowForPill;
  const mondayForPill = new Date(nowForPill);
  mondayForPill.setUTCDate(nowForPill.getUTCDate() + daysToMondayForPill);
  mondayForPill.setUTCHours(0, 0, 0, 0);
  const sundayForPill = new Date(mondayForPill);
  sundayForPill.setUTCDate(mondayForPill.getUTCDate() + 6);
  const weekStart = mondayForPill.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const weekEnd = sundayForPill.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return (
    <main>
      {/* JSON-LD: Organization */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Grainline",
          url: "https://thegrainline.com",
          logo: "https://thegrainline.com/logo-espresso.svg",
          description: "Marketplace for handmade woodworking pieces from independent makers across the country.",
        }) }}
      />
      {/* JSON-LD: WebSite with SearchAction */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: "Grainline",
          url: "https://thegrainline.com",
          potentialAction: {
            "@type": "SearchAction",
            target: { "@type": "EntryPoint", urlTemplate: "https://thegrainline.com/browse?q={search_term_string}" },
            "query-input": "required name=search_term_string",
          },
        }) }}
      />

      {/* ── Hero ───────────────────────────────────��─────────────────────── */}
      <section className={`relative border-b flex flex-col justify-center min-h-[60vh] ${
        mosaicPhotos.length >= 12
          ? "bg-[#1C1C1A]"
          : "bg-gradient-to-br from-amber-100 via-amber-50 to-stone-50"
      }`}>
        {mosaicPhotos.length >= 12 && <HeroMosaic photos={mosaicPhotos} />}
        <div className="relative z-20 max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center space-y-6 w-full">
          <h1 className={`text-display font-display ${mosaicPhotos.length >= 12 ? "text-white" : "text-neutral-900"}`}>
            Buy handmade.<br />Buy local. Buy quality.
          </h1>
          <p className={`text-lg ${mosaicPhotos.length >= 12 ? "text-white/80" : "text-stone-500"}`}>
            Handmade woodworking pieces from makers across the country.
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
        <ScrollSection className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap justify-center gap-x-8 gap-y-2">
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
            <span className="text-xl font-bold text-neutral-900">{membersCount.toLocaleString()}</span>
            <span className="text-sm text-stone-500">members</span>
          </div>
          <span className="text-amber-300 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{ordersCount.toLocaleString()}</span>
            <span className="text-sm text-stone-500">orders fulfilled</span>
          </div>
        </ScrollSection>
      </div>

      {/* ── Find Makers Near You ──────────────────────────────────────────── */}
      <ScrollSection className="py-12">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 mb-6">
          <h2 className="text-2xl sm:text-3xl font-bold font-display text-neutral-900">Find Makers Near You</h2>
          <p className="text-neutral-500 mt-1">Discover woodworkers in your neighborhood</p>
        </div>
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
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
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">

        {/* ── From Your Makers ─────────────────────────────────────────────── */}
        {fromYourMakers.length > 0 && (
          <ScrollSection>
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">Makers You Follow</h2>
              <Link href="/account/feed" className="text-sm text-neutral-600 hover:underline">
                See full feed →
              </Link>
            </div>
            <ScrollFadeRow className="overflow-x-auto -mx-1 px-1">
            <ul className="flex snap-x snap-mandatory gap-4 pb-0" style={{ width: "max-content" }}>
              {fromYourMakers.map((item) => (
                item.kind === "listing" ? (
                  <ClickTracker key={item.id} listingId={item.id} className="w-44 flex-none snap-start rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
                    <Link href={`/listing/${item.id}`} className="block">
                      <div className="aspect-square bg-neutral-100 overflow-hidden">
                        {item.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.photoUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-neutral-500">
                          {(item.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: item.currency })}
                        </p>
                        <p className="text-xs text-neutral-400 truncate">{item.sellerName}</p>
                      </div>
                    </Link>
                  </ClickTracker>
                ) : (
                  <li key={item.slug} className="w-44 flex-none snap-start rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
                    <Link href={`/blog/${item.slug}`} className="block">
                      <div className="aspect-square bg-neutral-100 overflow-hidden">
                        {item.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={item.coverImageUrl} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-amber-600">Blog post</p>
                        <p className="text-xs text-neutral-400 truncate">{item.sellerName}</p>
                      </div>
                    </Link>
                  </li>
                )
              ))}
            </ul>
            </ScrollFadeRow>
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
                  className="flex flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 p-4 sm:p-5 text-center hover:bg-amber-100 transition-colors flex-none w-28 sm:w-auto"
                >
                  <c.Icon size={28} className="text-amber-700" />
                  <span className="text-xs font-medium text-neutral-800">{c.label}</span>
                </Link>
              ))}
              <Link
                href="/browse"
                className="flex flex-col items-center justify-center gap-2 rounded-xl bg-amber-50 p-4 sm:p-5 text-center hover:bg-amber-100 transition-colors flex-none w-28 sm:w-auto"
              >
                <span className="text-2xl text-amber-700">→</span>
                <span className="text-xs font-medium text-neutral-800">Browse all</span>
              </Link>
            </div>
          </div>
        </ScrollSection>

        {/* ── Meet a Maker ─────────────────────────────────────────────────── */}
        {featuredMaker && (
          <ScrollSection>
            <div className="mb-5 space-y-0.5">
              <h2 className="text-xl font-semibold font-display">Meet a Maker</h2>
              <p className="text-sm text-neutral-500">The people behind the pieces</p>
            </div>

            <div className="rounded-2xl bg-stone-50 overflow-hidden">
              {featuredMaker.bannerImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={featuredMaker.bannerImageUrl} alt={`${featuredMaker.displayName ?? "Maker"} workshop`} loading="lazy" className="h-48 w-full object-cover" />
              )}
              <div className={`p-6 sm:p-8 ${featuredListings.length > 0 ? "lg:grid lg:grid-cols-2 lg:gap-8" : ""} flex flex-col gap-6`}>
                {/* Left column — maker info */}
                <div className="flex flex-col sm:flex-row gap-6 items-start">
                  <div className="shrink-0">
                    {(featuredMaker.avatarImageUrl ?? featuredMaker.user?.imageUrl) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={(featuredMaker.avatarImageUrl ?? featuredMaker.user?.imageUrl)!}
                        alt={featuredMaker.displayName ?? ""}
                        loading="lazy"
                        className="h-20 w-20 rounded-full border-2 border-white shadow object-cover"
                      />
                    ) : (
                      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-200 text-2xl font-bold text-amber-800 border-2 border-white shadow">
                        {(featuredMaker.displayName || "M")[0]?.toUpperCase()}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full mb-1">
                      Maker of the Week · {weekStart} – {weekEnd}
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-lg font-semibold">{featuredMaker.displayName}</span>
                      <GuildBadge level={featuredMaker.guildLevel as import("@/components/GuildBadge").GuildLevelValue} showLabel={true} size={32} />
                    </div>

                    {featuredMaker.tagline && (
                      <p className="text-sm text-neutral-600 italic border-l-2 border-amber-300 pl-3">&ldquo;{featuredMaker.tagline}&rdquo;</p>
                    )}

                    {(featuredMaker.city || featuredMaker.state) && (
                      <p className="text-xs text-neutral-500 flex items-center gap-1">
                        <MapPin size={12} className="shrink-0" />
                        {[featuredMaker.city, featuredMaker.state].filter(Boolean).join(", ")}
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
                        {featuredMaker.bio.slice(0, 120)}{featuredMaker.bio.length > 120 ? "…" : ""}
                      </p>
                    )}

                    <div className="pt-1">
                      <Link
                        href={`/seller/${featuredMaker.id}`}
                        className="inline-flex items-center rounded-md bg-[#2C1F1A] px-4 py-2 text-xs font-medium text-white hover:bg-[#3A2A24] transition-colors"
                      >
                        Visit Their Workshop →
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Right column — featured listings grid */}
                {featuredListings.length > 0 && (
                  <div className="grid grid-cols-3 gap-3 self-start">
                    {featuredListings.map((fl) => (
                      <Link key={fl.id} href={`/listing/${fl.id}`} className="block group">
                        <div className="aspect-square overflow-hidden rounded-xl">
                          {fl.photos[0]?.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={fl.photos[0].url}
                              alt={fl.title}
                              loading="lazy"
                              className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : (
                            <div className="h-full w-full bg-stone-100" />
                          )}
                        </div>
                        <div className="pt-2">
                          <div className="font-medium text-xs text-neutral-900 line-clamp-1">{fl.title}</div>
                          <div className="text-xs text-neutral-600">
                            ${(fl.priceCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollSection>
        )}

        {/* ── New Arrivals ───────────────────────────────────────── */}
        <ScrollSection>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold font-display">New Arrivals</h2>
            <Link href="/browse" className="text-sm text-neutral-600 hover:underline">Browse all</Link>
          </div>

          {fresh.length === 0 ? (
            <div className="card-section p-6 text-neutral-600">
              Nothing listed yet — check back soon.
            </div>
          ) : (
            <ScrollFadeRow className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
              <ul className="flex gap-4 snap-x snap-mandatory pb-0" style={{ width: "max-content" }}>
                {fresh.map((l) => {
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
            </ScrollFadeRow>
          )}
        </ScrollSection>

        {/* ── Top Picks ───────────────────────────────────────────── */}
        {topSaved.length > 0 && (
          <ScrollSection>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">Top Picks</h2>
            </div>

            <ScrollFadeRow className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
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
            </ScrollFadeRow>
          </ScrollSection>
        )}

        {/* ── From the Blog ────────────────────────────────────────────────── */}
        {recentBlogPosts.length > 0 && (
          <ScrollSection className="bg-amber-50/30 rounded-xl px-4 py-6 -mx-4">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">From the Blog</h2>
              <Link href="/blog" className="text-sm text-neutral-600 hover:underline">
                Read more stories
              </Link>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {recentBlogPosts.map((p) => {
                const authorName = p.sellerProfile?.displayName ?? p.author.name ?? "Staff";
                const authorAvatar = p.sellerProfile?.avatarImageUrl ?? p.author.imageUrl;
                return (
                  <li key={p.slug} className="relative card-listing">
                    <div className="absolute top-2 right-2 z-10">
                      <SaveBlogButton slug={p.slug} initialSaved={savedBlogSlugs.has(p.slug)} />
                    </div>
                    <Link href={`/blog/${p.slug}`} className="block">
                      <div className="aspect-[4/3] bg-stone-100 overflow-hidden">
                        {p.coverImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.coverImageUrl} alt={p.title} loading="lazy" className="w-full h-full object-cover" />
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
                            <img src={authorAvatar} alt={authorName} loading="lazy" className="h-5 w-5 rounded-full object-cover" />
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
      <ScrollSection className="border-t border-neutral-100 bg-amber-50">
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
