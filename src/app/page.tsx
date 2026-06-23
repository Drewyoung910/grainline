// src/app/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { unstable_cache } from "next/cache";
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
import MediaImage from "@/components/MediaImage";
import { truncateText, truncateTextWithEllipsis } from "@/lib/sanitize";
import SaveBlogButton from "@/components/SaveBlogButton";
import { getBlockedIdsFor } from "@/lib/blocks";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import { safeJsonLd } from "@/lib/json-ld";
import { publicListingWhere } from "@/lib/listingVisibility";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { isTrustedMediaUrl } from "@/lib/urlValidation";
import { getPopularListingTags } from "@/lib/popularTags";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { publicListingPath, publicSellerPath, publicTagPath } from "@/lib/publicPaths";
import { avatarInitial } from "@/lib/avatarInitials";
import { HOME_FEATURED_MAKER_CACHE_TAG } from "@/lib/searchCache";
import { compareAccountFeedItemsDesc } from "@/lib/accountFeedCursor";
import { formatCurrencyCents } from "@/lib/money";

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

const featuredMakerInclude = {
  user: { select: { imageUrl: true } },
} satisfies Prisma.SellerProfileInclude;

type FeaturedMaker = Prisma.SellerProfileGetPayload<{ include: typeof featuredMakerInclude }>;

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

const getFeaturedMakers = unstable_cache(async (): Promise<FeaturedMaker[]> => {
  const now = new Date();
  const picked: FeaturedMaker[] = [];
  const seen = new Set<string>();

  function add(maker: FeaturedMaker | null) {
    if (!maker || seen.has(maker.id) || picked.length >= 2) return;
    picked.push(maker);
    seen.add(maker.id);
  }

  // Tier 1: admin-featured (featuredUntil > now)
  const curated = await prisma.sellerProfile.findMany({
    where: activeSellerProfileWhere({ featuredUntil: { gt: now } }),
    orderBy: [{ featuredUntil: "desc" }, { id: "asc" }],
    include: featuredMakerInclude,
    take: 2,
  });
  for (const m of curated) add(m);

  // Tier 2: weekly Guild rotation (deterministic, fills remaining slots)
  if (picked.length < 2) {
    const guildWhere = activeSellerProfileWhere({
      guildLevel: { in: ["GUILD_MEMBER", "GUILD_MASTER"] },
      ...(seen.size > 0 ? { id: { notIn: [...seen] } } : {}),
    });
    const guildCount = await prisma.sellerProfile.count({ where: guildWhere });
    if (guildCount > 0) {
      const startIdx = makerWeekIndex(guildCount);
      const need = 2 - picked.length;
      // Pull up to (need * 2) so we have room if some collide with already-seen
      const weekly = await prisma.sellerProfile.findMany({
        where: guildWhere,
        orderBy: { id: "asc" },
        skip: startIdx,
        take: need,
        include: featuredMakerInclude,
      });
      for (const m of weekly) add(m);
      // Wrap-around if skip was near the end
      if (picked.length < 2 && weekly.length < need) {
        const wrap = await prisma.sellerProfile.findMany({
          where: guildWhere,
          orderBy: { id: "asc" },
          take: 2 - picked.length,
          include: featuredMakerInclude,
        });
        for (const m of wrap) add(m);
      }
    }
  }

  // Tier 3: top-reviewed fallback
  if (picked.length < 2) {
    const topReviewedRows = await prisma.$queryRaw<{ sellerId: string }[]>`
      SELECT sp.id AS "sellerId"
      FROM "SellerProfile" sp
      JOIN "User" u ON u.id = sp."userId"
      LEFT JOIN "SellerRatingSummary" srs ON srs."sellerProfileId" = sp.id
      WHERE sp."chargesEnabled" = true
        AND (sp."stripeAccountVersion" IS NULL OR sp."stripeAccountVersion" = 'v2')
        AND sp."vacationMode" = false
        AND u.banned = false
        AND u."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1
          FROM "Listing" l
          WHERE l."sellerId" = sp.id
            AND l.status = 'ACTIVE'
            AND l."isPrivate" = false
        )
      ORDER BY COALESCE(srs."reviewCount", 0) DESC, sp.id ASC
      LIMIT 4
    `;
    const candidateIds = topReviewedRows.map((r) => r.sellerId).filter((id) => !seen.has(id));
    if (candidateIds.length > 0) {
      const candidates = await prisma.sellerProfile.findMany({
        where: activeSellerProfileWhere({ id: { in: candidateIds } }),
        include: featuredMakerInclude,
      });
      // Preserve the SQL ordering
      const byId = new Map(candidates.map((c) => [c.id, c]));
      for (const id of candidateIds) {
        if (picked.length >= 2) break;
        const m = byId.get(id);
        if (m) add(m);
      }
    }
  }

  return picked;
}, ["home-featured-makers-v2"], { revalidate: 300, tags: [HOME_FEATURED_MAKER_CACHE_TAG] });

const featuredListingSelect = {
  id: true,
  title: true,
  priceCents: true,
  photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true, altText: true } },
} satisfies Prisma.ListingSelect;

type FeaturedListing = Prisma.ListingGetPayload<{ select: typeof featuredListingSelect }>;

type FeaturedMakerWithListings = {
  maker: FeaturedMaker;
  listings: FeaturedListing[];
};

const homeListingCardSelect = {
  id: true,
  title: true,
  priceCents: true,
  currency: true,
  status: true,
  listingType: true,
  stockQuantity: true,
  sellerId: true,
  photos: { take: 2, orderBy: { sortOrder: "asc" }, select: { url: true, altText: true } },
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
} satisfies Prisma.ListingSelect;

async function getFeaturedMakerBlock(blockedSellerIds: string[] = []): Promise<FeaturedMakerWithListings[]> {
  const blocked = new Set(blockedSellerIds);
  const makers = (await getFeaturedMakers()).filter((maker) => !blocked.has(maker.id));
  if (makers.length === 0) return [];

  return Promise.all(
    makers.map(async (maker) => {
      let listings: FeaturedListing[] = [];
      if (maker.featuredListingIds.length > 0) {
        const featuredRows = await prisma.listing.findMany({
          where: publicListingWhere({
            id: { in: maker.featuredListingIds },
            sellerId: maker.id,
            photos: { some: {} },
          }),
          select: featuredListingSelect,
        });
        const featuredById = new Map(featuredRows.map((listing) => [listing.id, listing]));
        listings = maker.featuredListingIds
          .map((listingId) => featuredById.get(listingId))
          .filter((listing): listing is FeaturedListing => listing !== undefined)
          .slice(0, 3);
      }
      if (listings.length < 3) {
        const existingIds = listings.map((l) => l.id);
        const more = await prisma.listing.findMany({
          where: publicListingWhere({
            sellerId: maker.id,
            photos: { some: {} },
            ...(existingIds.length > 0 ? { id: { notIn: existingIds } } : {}),
          }),
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
          select: featuredListingSelect,
          take: 3 - listings.length,
        });
        listings = [...listings, ...more];
      }
      return { maker, listings };
    })
  );
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

  const [
    fresh,
    topSaved,
    mapRows,
    trendingTagsRaw,
    statsResults,
    recentBlogPosts,
    mosaicListings,
    featuredMakerBlock,
  ] = await Promise.all([
    // New Arrivals: prefer last 30 days, fall back to newest if fewer than 12
    prisma.listing.findMany({
      where: publicListingWhere({
        createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
        ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      }),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: homeListingCardSelect,
    }).then(async (results) => {
      if (results.length >= 12) return results;
      // Fall back to newest without date filter
      return prisma.listing.findMany({
        where: publicListingWhere({
          ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
        }),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 12,
        select: homeListingCardSelect,
      });
    }),
    prisma.listing.findMany({
      where: publicListingWhere({
        qualityScore: { gt: 0 },
        ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
      }),
      orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: homeListingCardSelect,
    }),
    prisma.sellerProfile.findMany({
      where: activeSellerProfileWhere({
        publicMapOptIn: true,
        lat: { not: null },
        lng: { not: null },
        OR: [{ radiusMeters: null }, { radiusMeters: 0 }],
        ...(blockedSellerIds.length > 0 ? { id: { notIn: blockedSellerIds } } : {}),
      }),
      select: { id: true, displayName: true, city: true, state: true, lat: true, lng: true },
      orderBy: { id: "asc" },
      take: 200,
    }),
    getPopularListingTags(5),
    Promise.all([
      prisma.listing.count({ where: publicListingWhere() }),
      prisma.sellerProfile.count({
        where: activeSellerProfileWhere({ listings: { some: publicListingWhere() } }),
      }),
      prisma.order.count({
        where: {
          paidAt: { not: null },
          sellerRefundId: null,
          paymentEvents: { none: blockingRefundLedgerWhere() },
          fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
        },
      }),
      prisma.user.count({ where: { banned: false, deletedAt: null } }),
    ]),
    prisma.blogPost.findMany({
      where: publicBlogPostWhere({
        ...(blockedUserIds.size > 0 ? { authorId: { notIn: [...blockedUserIds] } } : {}),
      }),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 3,
      select: {
        id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true,
        author: { select: { name: true, imageUrl: true } },
        sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
      },
    }),
    prisma.listing.findMany({
      where: publicListingWhere(
        blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {},
      ),
      orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 24,
      select: {
        id: true,
        title: true,
        photos: {
          take: 1,
          orderBy: { sortOrder: "asc" },
          select: { url: true },
        },
      },
    }),
    getFeaturedMakerBlock(blockedSellerIds),
  ]);

  const [activeListingsCount, sellersCount, ordersCount, membersCount] = statsResults;
  const trendingTags = trendingTagsRaw;
  const featuredMakers = featuredMakerBlock;

  const mosaicPhotos: { url: string; listingId: string; title: string }[] = mosaicListings
    .filter(l => l.photos.length > 0)
    .map(l => ({ url: l.photos[0].url, listingId: l.id, title: l.title }))
    .filter(item => isTrustedMediaUrl(item.url));
  const hasHeroMosaic = mosaicPhotos.length >= 12;

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

  const featuredMakerFallbackImages = featuredMakers.map(({ maker, listings }) =>
    listings[0]?.photos[0]?.url ??
    maker.workshopImageUrl ??
    maker.avatarImageUrl ??
    maker.user?.imageUrl ??
    null
  );

  let saved = new Set<string>();
  let savedBlogSlugs = new Set<string>();
  type FromYourMakersItem =
    | { kind: "listing"; id: string; date: string; title: string; priceCents: number; currency: string; photoUrl: string | null; photoAltText: string | null; sellerName: string; sellerProfileId: string }
    | { kind: "blog"; id: string; date: string; slug: string; title: string; coverImageUrl: string | null; sellerName: string; sellerProfileId: string };
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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
          where: publicListingWhere({
            sellerId: { in: followedIds, ...(blockedSellerIds.length > 0 ? { notIn: blockedSellerIds } : {}) },
            createdAt: { gte: cutoff },
          }),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 6,
          select: {
            id: true, title: true, priceCents: true, currency: true, createdAt: true, sellerId: true,
            seller: { select: { displayName: true } },
            photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true, altText: true } },
          },
        }),
        prisma.blogPost.findMany({
          where: publicBlogPostWhere({
            sellerProfileId: { in: followedIds, ...(blockedSellerIds.length > 0 ? { notIn: blockedSellerIds } : {}) },
            publishedAt: { gte: cutoff },
          }),
          orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
          take: 6,
          select: {
            id: true, slug: true, title: true, coverImageUrl: true, publishedAt: true, sellerProfileId: true,
            sellerProfile: { select: { displayName: true } },
          },
        }),
      ]);

      const merged: FromYourMakersItem[] = [
        ...recentListings.map((l): FromYourMakersItem => ({
          kind: "listing", id: l.id, date: l.createdAt.toISOString(), title: l.title, priceCents: l.priceCents, currency: l.currency,
          photoUrl: l.photos[0]?.url ?? null,
          photoAltText: l.photos[0]?.altText ?? null,
          sellerName: l.seller.displayName ?? "Maker",
          sellerProfileId: l.sellerId,
        })),
        ...recentPosts.map((p): FromYourMakersItem => ({
          kind: "blog", id: p.id, date: (p.publishedAt ?? new Date(0)).toISOString(), slug: p.slug, title: p.title, coverImageUrl: p.coverImageUrl,
          sellerName: p.sellerProfile?.displayName ?? "Maker",
          sellerProfileId: p.sellerProfileId ?? "",
        })),
      ];
      fromYourMakers = merged.sort(compareAccountFeedItemsDesc).slice(0, 6);
    }
  }

  const sellerIds = Array.from(
    new Set([
      ...fresh.map((f) => f.sellerId),
      ...topSaved.map((t) => t.sellerId),
      ...featuredMakers.map(({ maker }) => maker.id),
    ])
  );
  const sellerRatings = await getSellerRatingMap(sellerIds);

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
      <section className={`relative flex flex-col justify-center min-h-[60vh] ${
        hasHeroMosaic
          ? "bg-[#1C1C1A]"
          : "bg-gradient-to-br from-amber-100 via-amber-50 to-stone-50"
      }`}>
        {hasHeroMosaic && <HeroMosaic photos={mosaicPhotos} />}
        <div className="relative z-20 max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-20 text-center space-y-6 w-full">
          <div className="flex justify-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wider ${
                hasHeroMosaic
                  ? "bg-white/15 text-white/90 backdrop-blur-sm ring-1 ring-white/30"
                  : "bg-white text-amber-800 ring-1 ring-amber-200"
              }`}
            >
              <span aria-hidden="true">★</span>
              Made in the USA · Built in Texas
            </span>
          </div>
          <h1 className={`text-display font-display ${hasHeroMosaic ? "text-white" : "text-neutral-900"}`}>
            Buy handmade.<br />Buy local. Buy quality.
          </h1>

          <div className={`max-w-xl mx-auto ${hasHeroMosaic ? "[&_input]:bg-white/20 [&_input]:backdrop-blur-sm [&_input]:border-white/30 [&_input]:text-white [&_input]:placeholder-white/60" : ""}`}>
            <Suspense>
              <SearchBar variant={hasHeroMosaic ? "glass" : "default"} />
            </Suspense>
          </div>

          {trendingTags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2 pt-1">
              <span className={`text-xs self-center ${hasHeroMosaic ? "text-white/60" : "text-neutral-500"}`}>Trending:</span>
              {trendingTags.map((tag) => (
                <Link
                  key={tag}
                  href={publicTagPath(tag)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    hasHeroMosaic
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
                hasHeroMosaic
                  ? "border-white text-white hover:bg-white hover:text-neutral-900"
                  : "border-[#2C1F1A] bg-transparent text-[#2C1F1A] hover:bg-[#2C1F1A] hover:text-white"
              }`}
            >
              Find Makers Near You
            </Link>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className={`absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce motion-reduce:animate-none ${hasHeroMosaic ? "text-white/60" : "text-neutral-500"}`}>
          <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </div>
      </section>

      {/* ── Stats bar ────────────────────────────────────────────────────── */}
      <div className="bg-[#D9E2D5]">
        <ScrollSection className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-wrap justify-center gap-x-8 gap-y-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{activeListingsCount.toLocaleString("en-US")}</span>
            <span className="text-sm text-neutral-700">pieces listed</span>
          </div>
          <span className="text-[#3F5D3A]/40 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{sellersCount.toLocaleString("en-US")}</span>
            <span className="text-sm text-neutral-700">active makers</span>
          </div>
          <span className="text-[#3F5D3A]/40 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{membersCount.toLocaleString("en-US")}</span>
            <span className="text-sm text-neutral-700">members</span>
          </div>
          <span className="text-[#3F5D3A]/40 self-center hidden sm:block">·</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-bold text-neutral-900">{ordersCount.toLocaleString("en-US")}</span>
            <span className="text-sm text-neutral-700">orders fulfilled</span>
          </div>
        </ScrollSection>
      </div>

      {/* ── Find Makers Near You ──────────────────────────────────────────── */}
      <ScrollSection className="py-12">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <MakersMapSection
            points={mapPoints}
            heading="Find Makers Near You"
            subheading="Share your location to see makers in your area, or browse the full national map."
            headingClassName="font-display text-2xl sm:text-3xl font-bold text-neutral-900"
          />
        </div>
      </ScrollSection>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="bg-[#F7F5F0]">
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
                    <Link href={publicListingPath(item.id, item.title)} className="block">
                      <div className="aspect-[4/5] bg-neutral-100 overflow-hidden">
                        <MediaImage
                          src={item.photoUrl}
                          alt={item.photoAltText ?? item.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          fallbackClassName="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100"
                        />
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-neutral-500">
                          {formatCurrencyCents(item.priceCents, item.currency)}
                        </p>
                        <p className="text-xs text-neutral-500 truncate">{item.sellerName}</p>
                      </div>
                    </Link>
                  </ClickTracker>
                ) : (
                  <li key={item.slug} className="w-44 flex-none snap-start rounded-2xl overflow-hidden hover:shadow-lg hover:-translate-y-1 transition-all duration-200">
                    <Link href={`/blog/${item.slug}`} className="block">
                      <div className="aspect-square bg-neutral-100 overflow-hidden">
                        <MediaImage
                          src={item.coverImageUrl}
                          alt={item.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          fallbackClassName="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100"
                        />
                      </div>
                      <div className="p-2">
                        <p className="text-xs font-medium text-neutral-900 truncate">{item.title}</p>
                        <p className="text-xs text-amber-700">Blog post</p>
                        <p className="text-xs text-neutral-500 truncate">{item.sellerName}</p>
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
          {/* Mobile: horizontal scroll with fade; Desktop: 9-col grid (no fade) */}
          <ScrollFadeRow hideAtBreakpoint="sm" className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex sm:grid sm:grid-cols-9 gap-3" style={{ minWidth: 480 }}>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  href={`/browse?category=${c.key}`}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#D9E2D5] p-4 sm:p-5 text-center hover:bg-[#C7D4C2] transition-colors flex-none w-28 sm:w-auto"
                >
                  <c.Icon size={28} className="text-neutral-900" />
                  <span className="text-xs font-medium text-neutral-900">{c.label}</span>
                </Link>
              ))}
              <Link
                href="/browse"
                className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#D9E2D5] p-4 sm:p-5 text-center hover:bg-[#C7D4C2] transition-colors flex-none w-28 sm:w-auto"
              >
                <span className="text-2xl text-neutral-900">→</span>
                <span className="text-xs font-medium text-neutral-900">Browse all</span>
              </Link>
            </div>
          </ScrollFadeRow>
        </ScrollSection>

        {/* ── Featured Makers ────────────────────────────────────────── */}
        {featuredMakers.length > 0 && (
          <ScrollSection>
            <div className="mb-5 flex items-end justify-between gap-4 flex-wrap">
              <div className="space-y-0.5">
                <h2 className="text-xl font-semibold font-display">
                  {featuredMakers.length > 1 ? "Featured Makers" : "Meet a Maker"}
                </h2>
                <p className="text-sm text-neutral-500">The people behind the pieces, {weekStart} to {weekEnd}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {featuredMakers.map(({ maker, listings }, idx) => {
                const fallbackImage = featuredMakerFallbackImages[idx];
                const rating = sellerRatings.get(maker.id) ?? null;
                const avatarSrc = maker.avatarImageUrl ?? maker.user?.imageUrl ?? null;
                return (
                  <article key={maker.id} className="flex flex-col">
                    {/* Banner with 3:1 aspect, rounded, avatar overlaps bottom */}
                    <div className="relative">
                      <div className="rounded-2xl overflow-hidden">
                        <MediaImage
                          src={maker.bannerImageUrl}
                          fallbackSrc={fallbackImage}
                          alt={`${maker.displayName ?? "Maker"} workshop`}
                          loading="lazy"
                          className="aspect-[3/1] w-full object-cover"
                          fallbackClassName="aspect-[3/1] w-full bg-gradient-to-r from-neutral-800 to-neutral-600"
                        />
                      </div>
                      <div className="absolute -bottom-10 left-6">
                        {avatarSrc ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={avatarSrc}
                            alt={maker.displayName ?? ""}
                            loading="lazy"
                            width={80}
                            height={80}
                            className="h-20 w-20 rounded-full object-cover ring-4 ring-[#F7F5F0] shadow-sm bg-white"
                          />
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-200 text-2xl font-bold text-amber-800 ring-4 ring-[#F7F5F0] shadow-sm">
                            {avatarInitial(maker.displayName, "M")}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="px-6 pt-14 pb-6 flex-1 flex flex-col">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold">{maker.displayName}</h3>
                        <GuildBadge
                          level={maker.guildLevel as import("@/components/GuildBadge").GuildLevelValue}
                          size={28}
                        />
                      </div>

                      {maker.tagline && (
                        <p className="text-sm text-neutral-700 italic border-l-2 border-amber-300 pl-3 mb-3">
                          &ldquo;{maker.tagline}&rdquo;
                        </p>
                      )}

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-600 mb-3">
                        {(maker.city || maker.state) && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} className="shrink-0" />
                            {[maker.city, maker.state].filter(Boolean).join(", ")}
                          </span>
                        )}
                        {rating && rating.count > 0 && (
                          <span className="flex items-center gap-1">
                            <StarsInline value={rating.avg} />
                            <span>{(Math.round(rating.avg * 10) / 10).toFixed(1)}</span>
                            <span className="text-neutral-500">({rating.count})</span>
                          </span>
                        )}
                      </div>

                      {maker.bio && (
                        <p className="text-sm text-neutral-700 line-clamp-2 mb-4">
                          {truncateTextWithEllipsis(maker.bio, 140)}
                        </p>
                      )}

                      {listings.length > 0 && (
                        <div className="grid grid-cols-3 gap-2 mb-4">
                          {listings.slice(0, 3).map((fl) => (
                            <Link key={fl.id} href={publicListingPath(fl.id, fl.title)} className="block group">
                              <div className="aspect-square overflow-hidden rounded-lg bg-white">
                                <MediaImage
                                  src={fl.photos[0]?.url ?? null}
                                  alt={fl.photos[0]?.altText ?? fl.title}
                                  loading="lazy"
                                  className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                                  fallbackClassName="h-full w-full bg-stone-100"
                                />
                              </div>
                            </Link>
                          ))}
                        </div>
                      )}

                      <div className="mt-auto">
                        <Link
                          href={publicSellerPath(maker.id, maker.displayName)}
                          className="inline-flex items-center rounded-md bg-[#2C1F1A] px-4 py-2 text-xs font-medium text-white hover:bg-[#3A2A24] transition-colors"
                        >
                          Visit Their Workshop →
                        </Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </ScrollSection>
        )}

        {/* ── New Arrivals ───────────────────────────────────────── */}
        <ScrollSection>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold font-display">New Arrivals</h2>
            <Link href="/browse?sort=newest" className="text-sm text-amber-700 hover:underline">View more →</Link>
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
                    <ClickTracker key={l.id} listingId={l.id} className="snap-start flex-none w-44 sm:w-48">
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
              <Link href="/browse?sort=popular" className="text-sm text-amber-700 hover:underline">View more →</Link>
            </div>

            <ScrollFadeRow className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
              <ul className="flex gap-4 snap-x snap-mandatory pb-0" style={{ width: "max-content" }}>
                {topSaved.map((l) => {
                  return (
                    <ClickTracker key={l.id} listingId={l.id} className="snap-start flex-none w-44 sm:w-48">
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
                const authorName = p.sellerProfile?.displayName ?? p.author?.name ?? "Former author";
                const authorAvatar = p.sellerProfile?.avatarImageUrl ?? p.author?.imageUrl;
                return (
                  <li key={p.slug} className="relative card-listing">
                    <div className="absolute top-2 right-2 z-10">
                      <SaveBlogButton slug={p.slug} initialSaved={savedBlogSlugs.has(p.slug)} />
                    </div>
                    <Link href={`/blog/${p.slug}`} className="block">
                      <div className="aspect-[4/3] bg-stone-100 overflow-hidden">
                        <MediaImage
                          src={p.coverImageUrl}
                          alt={p.title}
                          loading="lazy"
                          className="w-full h-full object-cover"
                          fallbackClassName="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100"
                        />
                      </div>
                      <div className="p-4 space-y-2 bg-[#EFEAE0]">
                        <h3 className="font-medium text-sm text-neutral-900 line-clamp-2">{p.title}</h3>
                        {p.excerpt && (
                          <p className="text-xs text-stone-500 line-clamp-2">{truncateText(p.excerpt, 100)}</p>
                        )}
                        <div className="flex items-center gap-1.5">
                          {authorAvatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={authorAvatar} alt={authorName} loading="lazy" width={20} height={20} className="h-5 w-5 rounded-full object-cover" />
                          ) : (
                            <div className="h-5 w-5 rounded-full bg-neutral-200" />
                          )}
                          <span className="text-xs text-stone-500">{authorName}</span>
                          {p.publishedAt && (
                            <span className="text-xs text-stone-500 ml-auto">
                              {new Date(p.publishedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
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
      <ScrollSection className="bg-[#F7F5F0]">
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
