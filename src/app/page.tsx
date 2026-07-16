// src/app/page.tsx
import Link from "next/link";
import Image from "next/image";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { unstable_cache } from "next/cache";
import MakersMapSection from "@/components/MakersMapSection";
import { ScrollSection } from "@/components/ScrollSection";
import GuildBadge from "@/components/GuildBadge";
import FoundingMakerBadge from "@/components/FoundingMakerBadge";
import { Armchair, Utensils, Candle, Toy, Box, Gift, TreePine, Palette, MapPin } from "@/components/icons";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";
import MediaImage from "@/components/MediaImage";
import { truncateText, truncateTextWithEllipsis } from "@/lib/sanitize";
import SaveBlogButton from "@/components/SaveBlogButton";
import { getBlockedIdsFor } from "@/lib/blocks";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import { safeJsonLd } from "@/lib/json-ld";
import { publicListingWhere } from "@/lib/listingVisibility";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { getCachedPublicSellerStats } from "@/lib/publicSellerStats";
import FollowButton from "@/components/FollowButton";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { avatarInitial } from "@/lib/avatarInitials";
import { HOME_FEATURED_MAKER_CACHE_TAG } from "@/lib/searchCache";
import { compareAccountFeedItemsDesc } from "@/lib/accountFeedCursor";
import { formatCurrencyCents } from "@/lib/money";
import { ownerSavedBlogPostIdRows } from "@/lib/savedBlogPostOwnerAccess";
import { getCachedHomepageStats } from "@/lib/homepageStats";
import { BLOG_TYPE_COLORS, BLOG_TYPE_LABELS } from "@/lib/blog";

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

const featuredMakerSelect = {
  id: true,
  userId: true,
  displayName: true,
  bio: true,
  storyBody: true,
  yearsInBusiness: true,
  createdAt: true,
  city: true,
  state: true,
  tagline: true,
  bannerImageUrl: true,
  avatarImageUrl: true,
  workshopImageUrl: true,
  featuredListingIds: true,
  guildLevel: true,
  isFoundingMaker: true,
  foundingMakerNumber: true,
  user: { select: { imageUrl: true } },
} satisfies Prisma.SellerProfileSelect;

type FeaturedMaker = Prisma.SellerProfileGetPayload<{ select: typeof featuredMakerSelect }>;

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
    select: featuredMakerSelect,
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
        select: featuredMakerSelect,
      });
      for (const m of weekly) add(m);
      // Wrap-around if skip was near the end
      if (picked.length < 2 && weekly.length < need) {
        const wrap = await prisma.sellerProfile.findMany({
          where: guildWhere,
          orderBy: { id: "asc" },
          take: 2 - picked.length,
          select: featuredMakerSelect,
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
    let candidateIds = topReviewedRows.map((r) => r.sellerId).filter((id) => !seen.has(id));
    // Weekly rotation within the fallback pool too — without this, the
    // single most-reviewed maker would hold the spotlight indefinitely
    // whenever no Guild members exist yet.
    if (candidateIds.length > 1) {
      const offset = makerWeekIndex(candidateIds.length);
      candidateIds = [...candidateIds.slice(offset), ...candidateIds.slice(0, offset)];
    }
    if (candidateIds.length > 0) {
      const candidates = await prisma.sellerProfile.findMany({
        where: activeSellerProfileWhere({ id: { in: candidateIds } }),
        select: featuredMakerSelect,
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
}, ["home-featured-makers-v4"], { revalidate: 300, tags: [HOME_FEATURED_MAKER_CACHE_TAG] });

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
    recentBlogPosts,
    featuredMakerBlock,
    homepageStats,
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
    prisma.blogPost.findMany({
      where: publicBlogPostWhere({
        ...(blockedUserIds.size > 0 ? { authorId: { notIn: [...blockedUserIds] } } : {}),
        ...(blockedSellerIds.length > 0
          ? { OR: [{ sellerProfileId: null }, { sellerProfileId: { notIn: blockedSellerIds } }] }
          : {}),
      }),
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take: 3,
      select: {
        id: true, slug: true, title: true, excerpt: true, coverImageUrl: true, type: true, readingTimeMinutes: true, publishedAt: true,
        author: {
          select: {
            name: true,
            imageUrl: true,
            sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
          },
        },
        sellerProfile: { select: { displayName: true, avatarImageUrl: true } },
      },
    }),
    getFeaturedMakerBlock(blockedSellerIds),
    getCachedHomepageStats(),
  ]);

  const featuredMakers = featuredMakerBlock;

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
      ownerSavedBlogPostIdRows(meDbId, blogPostIds),
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

  // Spotlight data: follower counts + viewer follow state for the featured
  // makers, and cached sold-count stats for the main spotlight only.
  const featuredMakerIds = featuredMakers.map(({ maker }) => maker.id);
  let featuredFollowerCounts = new Map<string, number>();
  let featuredFollowing = new Set<string>();
  if (featuredMakerIds.length > 0) {
    const [followCounts, myFollows] = await Promise.all([
      prisma.follow.groupBy({
        by: ["sellerProfileId"],
        where: { sellerProfileId: { in: featuredMakerIds } },
        _count: { _all: true },
      }),
      meDbId
        ? prisma.follow.findMany({
            where: { followerId: meDbId, sellerProfileId: { in: featuredMakerIds } },
            select: { sellerProfileId: true },
          })
        : Promise.resolve([] as { sellerProfileId: string }[]),
    ]);
    featuredFollowerCounts = new Map(followCounts.map((c) => [c.sellerProfileId, c._count._all]));
    featuredFollowing = new Set(myFollows.map((f) => f.sellerProfileId));
  }
  const spotlightStats =
    featuredMakers.length > 0
      ? await getCachedPublicSellerStats(featuredMakers[0].maker.id).catch(() => null)
      : null;

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
    <main className="overflow-x-hidden">
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

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section
        data-home-hero
        className="relative isolate h-[clamp(520px,68svh,600px)] overflow-hidden bg-[#18201f] sm:h-[clamp(600px,78svh,760px)]"
      >
        <Image
          src="/hero-maple-cabinets.jpg"
          alt=""
          aria-hidden="true"
          fill
          preload
          quality={88}
          sizes="(max-width: 639px) 150vw, 100vw"
          className="object-cover object-[43%_58%] sm:object-[26%_58%] md:object-[35%_58%] lg:object-[center_58%]"
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(44,31,26,0.78)_0%,rgba(44,31,26,0.62)_44%,rgba(44,31,26,0.24)_76%,rgba(44,31,26,0.04)_100%)] lg:bg-[linear-gradient(90deg,rgba(44,31,26,0.78)_0%,rgba(44,31,26,0.60)_28%,rgba(44,31,26,0.18)_48%,rgba(44,31,26,0)_66%)]"
          aria-hidden="true"
        />
        <div
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(44,31,26,0.12)_0%,rgba(44,31,26,0)_24%,rgba(44,31,26,0)_82%,rgba(44,31,26,0.10)_100%)]"
          aria-hidden="true"
        />

        <div className="relative z-10 mx-auto flex h-full max-w-[1600px] items-center px-4 pb-14 pt-24 sm:px-6 sm:pb-16 sm:pt-28 lg:px-8">
          <div className="w-full max-w-[630px] text-left text-[#E5DFD2]">
            <h1 className="font-display text-[clamp(2.125rem,10.5vw,4rem)] font-semibold leading-[0.96] drop-shadow-[0_2px_18px_rgba(0,0,0,0.24)] sm:text-[clamp(3.5rem,7vw,4.75rem)] lg:text-[clamp(4rem,5vw,5.25rem)]">
              <span className="block whitespace-nowrap">Buy handmade.</span>
              <span className="block whitespace-nowrap">Buy local.</span>
              <span className="block whitespace-nowrap">Buy quality.</span>
            </h1>
            <p className="mt-6 max-w-md text-base leading-relaxed text-[#E5DFD2]/85 sm:text-lg">
              More than what&apos;s made for everyone.
            </p>
            <div className="mt-7 flex flex-col items-start gap-3 sm:mt-8 sm:flex-row">
              <Link
                href="/browse"
                data-home-primary-cta
                className="inline-flex min-h-[46px] w-fit items-center justify-center rounded-full border border-[#E5DFD2]/65 bg-[#E5DFD2]/70 px-5 py-3 text-sm font-semibold text-[#2C1F1A] shadow-sm backdrop-blur-md transition-[background-color,border-color] hover:bg-[#E5DFD2]/85 active:bg-[#E5DFD2]/80 sm:px-6"
              >
                Browse
              </Link>
              <Link
                href="/map"
                data-home-secondary-cta
                className="inline-flex min-h-[46px] w-fit items-center justify-center rounded-full border border-[#E5DFD2]/55 bg-[#E5DFD2]/[0.08] px-5 py-3 text-sm font-semibold text-[#E5DFD2] backdrop-blur-md transition-[background-color,border-color] hover:border-[#E5DFD2]/70 hover:bg-[#E5DFD2]/15 active:bg-[#E5DFD2]/20 sm:px-6"
              >
                Find Shops Near You
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Zero-height anchor + 50% translation keeps the bar exactly half
          inside and half outside the hero at every responsive height. */}
      <section
        data-home-stats
        aria-label="Grainline marketplace statistics"
        className="relative z-30 h-0 px-4 sm:px-6 lg:px-8"
      >
        <dl
          data-home-stats-surface
          className="mx-auto grid w-full max-w-md -translate-y-1/2 grid-cols-4 divide-x divide-[#2C1F1A]/[0.12] rounded-2xl border border-white/30 bg-[#F7F5F0]/46 px-1 py-3 shadow-[0_18px_45px_rgba(28,25,23,0.14)] ring-1 ring-white/20 backdrop-blur-xl sm:max-w-5xl sm:px-5 sm:py-4"
        >
          <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center sm:px-4">
            <dt className="order-2 mt-1 text-[9px] leading-tight text-[#2C1F1A]/65 sm:text-xs">pieces listed</dt>
            <dd className="order-1 text-lg font-semibold leading-none text-[#2C1F1A] sm:text-2xl">
              {homepageStats.pieces.toLocaleString("en-US")}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center sm:px-4">
            <dt className="order-2 mt-1 text-[9px] leading-tight text-[#2C1F1A]/65 sm:text-xs">active makers</dt>
            <dd className="order-1 text-lg font-semibold leading-none text-[#2C1F1A] sm:text-2xl">
              {homepageStats.makers.toLocaleString("en-US")}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center sm:px-4">
            <dt className="order-2 mt-1 text-[9px] leading-tight text-[#2C1F1A]/65 sm:text-xs">members</dt>
            <dd className="order-1 text-lg font-semibold leading-none text-[#2C1F1A] sm:text-2xl">
              {homepageStats.members.toLocaleString("en-US")}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col items-center justify-center px-1 text-center sm:px-4">
            <dt className="order-2 mt-1 text-[9px] leading-tight text-[#2C1F1A]/65 sm:text-xs">orders fulfilled</dt>
            <dd className="order-1 text-lg font-semibold leading-none text-[#2C1F1A] sm:text-2xl">
              {homepageStats.fulfilledOrders.toLocaleString("en-US")}
            </dd>
          </div>
        </dl>
      </section>

      {/* ── Find Shops Near You ───────────────────────────────────────────── */}
      <ScrollSection className="pb-6 pt-16 sm:pb-8 sm:pt-20">
        <div data-home-map className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <MakersMapSection
            points={mapPoints}
            heading="Find Shops Near You"
            subheading="See what people are building nearby, or explore shops across the country."
            headingClassName="font-display text-2xl sm:text-3xl font-bold text-neutral-900"
            compact
          />
        </div>
      </ScrollSection>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div className="bg-[#F7F5F0]">
      <div className="max-w-[1600px] mx-auto px-4 pb-12 pt-4 sm:px-6 sm:pt-6 lg:px-8 space-y-10">

        {/* ── Top Picks ───────────────────────────────────────────── */}
        {topSaved.length > 0 && (
          <ScrollSection>
            <div data-home-top-picks className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">Top Picks</h2>
              <Link href="/browse?sort=popular" className="text-sm font-semibold text-neutral-800 underline-offset-4 transition-colors hover:text-amber-800 hover:underline">View more →</Link>
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

        {/* ── Shop by Category ─────────────────────────────────────────────── */}
        <ScrollSection>
          <h2 data-home-categories className="text-xl font-semibold font-display mb-5">Shop by Category</h2>
          {/* Mobile: horizontal scroll with fade; Desktop: 9-col grid (no fade) */}
          <ScrollFadeRow hideAtBreakpoint="sm" className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <div className="flex sm:grid sm:grid-cols-9 gap-3" style={{ minWidth: 480 }}>
              {CATEGORIES.map((c) => (
                <Link
                  key={c.key}
                  href={`/browse?category=${c.key}`}
                  className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#EFEAE0] p-4 sm:p-5 text-center hover:bg-[#E3DCCB] transition-colors flex-none w-28 sm:w-auto"
                >
                  <c.Icon size={28} className="text-neutral-900" />
                  <span className="text-xs font-medium text-neutral-900">{c.label}</span>
                </Link>
              ))}
              <Link
                href="/browse"
                className="flex flex-col items-center justify-center gap-2 rounded-xl bg-[#EFEAE0] p-4 sm:p-5 text-center hover:bg-[#E3DCCB] transition-colors flex-none w-28 sm:w-auto"
              >
                <span className="text-2xl text-neutral-900">→</span>
                <span className="text-xs font-medium text-neutral-900">Browse all</span>
              </Link>
            </div>
          </ScrollFadeRow>
        </ScrollSection>

        {/* ── New Arrivals ───────────────────────────────────────── */}
        <ScrollSection>
          <div data-home-new-arrivals className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold font-display">New Arrivals</h2>
            <Link href="/browse?sort=newest" className="text-sm font-semibold text-neutral-800 underline-offset-4 transition-colors hover:text-amber-800 hover:underline">View more →</Link>
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

        {/* ── From Your Makers ─────────────────────────────────────────────── */}
        {fromYourMakers.length > 0 && (
          <ScrollSection>
            <div data-home-followed-makers className="mb-5 flex items-center justify-between">
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

        {/* ── In the Workshop — maker spotlight + also-featured strip ── */}
        {featuredMakers.length > 0 && (() => {
          const [spotlightBlock, alsoBlock] = featuredMakers;
          const spotlight = spotlightBlock.maker;
          const spotlightListings = spotlightBlock.listings;
          const spotlightRating = sellerRatings.get(spotlight.id) ?? null;
          const spotlightAvatar = spotlight.avatarImageUrl ?? spotlight.user?.imageUrl ?? null;
          // Image priority favors ratios that crop well in the tall slot:
          // workshop (3:2), then the maker's best listing photo (4:5), then
          // the 3:1 banner as a last resort before the gradient fallback.
          const spotlightImage =
            spotlight.workshopImageUrl ??
            spotlightListings[0]?.photos[0]?.url ??
            spotlight.bannerImageUrl ??
            featuredMakerFallbackImages[0];
          const spotlightStory = spotlight.storyBody ?? spotlight.bio ?? null;
          const memberSinceYear = new Date(spotlight.createdAt).getFullYear();
          const soldCount = spotlightStats?.soldCount ?? 0;
          return (
            <ScrollSection>
              <div data-home-workshop className="mb-5 space-y-0.5">
                <h2 className="text-xl font-semibold font-display">In the Workshop</h2>
                <p className="text-sm text-neutral-500">
                  Maker of the Week · {weekStart} to {weekEnd}
                </p>
              </div>

              {/* Spotlight card — image half + story half */}
              <article className="overflow-hidden rounded-3xl bg-[#EFEAE0] shadow-sm lg:grid lg:grid-cols-[1.05fr_1fr]">
                {/* Workshop image */}
                <div className="relative min-h-[240px] sm:min-h-[300px] lg:min-h-[440px]">
                  <MediaImage
                    src={spotlightImage}
                    alt={`${spotlight.displayName ?? "Maker"} workshop`}
                    loading="lazy"
                    className="absolute inset-0 h-full w-full object-cover"
                    fallbackClassName="absolute inset-0 h-full w-full bg-gradient-to-br from-neutral-800 to-neutral-600"
                  />
                  {/* Identity chip over the photo */}
                  <Link
                    href={publicSellerPath(spotlight.id, spotlight.displayName)}
                    className="absolute bottom-4 left-4 flex items-center gap-2.5 rounded-full bg-white/90 py-1.5 pl-1.5 pr-4 shadow-sm backdrop-blur-sm transition-colors hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {spotlightAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={spotlightAvatar}
                        alt=""
                        loading="lazy"
                        width={36}
                        height={36}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-200 text-sm font-bold text-amber-800">
                        {avatarInitial(spotlight.displayName, "M")}
                      </div>
                    )}
                    <span className="text-sm font-semibold text-neutral-900">
                      {spotlight.displayName}
                    </span>
                  </Link>
                </div>

                {/* Story side */}
                <div className="flex flex-col p-6 sm:p-8 lg:p-10">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Maker of the Week
                  </p>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-2xl font-semibold text-neutral-900 sm:text-3xl">
                      {spotlight.displayName}
                    </h3>
                    <GuildBadge
                      level={spotlight.guildLevel as import("@/components/GuildBadge").GuildLevelValue}
                      size={30}
                    />
                    {spotlight.isFoundingMaker && (
                      <FoundingMakerBadge number={spotlight.foundingMakerNumber} size={26} />
                    )}
                  </div>

                  {spotlight.tagline && (
                    <p className="mb-4 border-l-2 border-amber-400 pl-4 text-base italic text-neutral-700 sm:text-lg">
                      &ldquo;{spotlight.tagline}&rdquo;
                    </p>
                  )}

                  {/* Proof stats */}
                  <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-neutral-700">
                    {spotlightRating && spotlightRating.count > 0 && (
                      <span className="flex items-center gap-1">
                        <StarsInline value={spotlightRating.avg} />
                        <span className="font-medium">
                          {(Math.round(spotlightRating.avg * 10) / 10).toFixed(1)}
                        </span>
                        <span className="text-neutral-500">({spotlightRating.count})</span>
                      </span>
                    )}
                    {soldCount > 0 && (
                      <span>
                        {soldCount.toLocaleString("en-US")} piece{soldCount !== 1 ? "s" : ""} sold
                      </span>
                    )}
                    {spotlight.yearsInBusiness != null && spotlight.yearsInBusiness > 0 ? (
                      <span>
                        {spotlight.yearsInBusiness} year{spotlight.yearsInBusiness !== 1 ? "s" : ""} crafting
                      </span>
                    ) : (
                      <span>Member since {memberSinceYear}</span>
                    )}
                    {(spotlight.city || spotlight.state) && (
                      <span className="flex items-center gap-1 text-neutral-600">
                        <MapPin size={13} className="shrink-0" />
                        {[spotlight.city, spotlight.state].filter(Boolean).join(", ")}
                      </span>
                    )}
                  </div>

                  {spotlightStory && (
                    <p className="mb-5 text-sm leading-relaxed text-neutral-700 line-clamp-3">
                      {truncateTextWithEllipsis(spotlightStory, 260)}
                    </p>
                  )}

                  <div className="mb-6 flex flex-wrap items-center gap-2.5">
                    <Link
                      href={publicSellerPath(spotlight.id, spotlight.displayName)}
                      className="inline-flex items-center text-sm font-semibold text-neutral-900 underline-offset-4 transition-colors hover:text-amber-800 hover:underline"
                    >
                      Visit the Workshop →
                    </Link>
                    {meDbId !== spotlight.userId && (
                      <FollowButton
                        sellerProfileId={spotlight.id}
                        initialFollowing={featuredFollowing.has(spotlight.id)}
                        initialCount={featuredFollowerCounts.get(spotlight.id) ?? 0}
                        size="sm"
                      />
                    )}
                  </div>

                  {spotlightListings.length > 0 && (
                    <div className="mt-auto grid grid-cols-3 gap-2.5">
                      {spotlightListings.slice(0, 3).map((fl) => (
                        <Link key={fl.id} href={publicListingPath(fl.id, fl.title)} className="group block">
                          <div className="aspect-square overflow-hidden rounded-xl bg-white">
                            <MediaImage
                              src={fl.photos[0]?.url ?? null}
                              alt={fl.photos[0]?.altText ?? fl.title}
                              loading="lazy"
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                              fallbackClassName="h-full w-full bg-stone-100"
                            />
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </article>

              {/* Also featured this week — slim strip for the second maker */}
              {alsoBlock && (() => {
                const also = alsoBlock.maker;
                const alsoRating = sellerRatings.get(also.id) ?? null;
                const alsoAvatar = also.avatarImageUrl ?? also.user?.imageUrl ?? null;
                return (
                  <div className="mt-4 card-section !bg-[#EFEAE0] flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      Also featured
                    </span>
                    {alsoAvatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={alsoAvatar}
                        alt=""
                        loading="lazy"
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full object-cover ring-1 ring-neutral-200"
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-200 text-sm font-bold text-amber-800">
                        {avatarInitial(also.displayName, "M")}
                      </div>
                    )}
                    <div className="min-w-[10rem] flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={publicSellerPath(also.id, also.displayName)}
                          className="truncate text-sm font-semibold text-neutral-900 hover:underline"
                        >
                          {also.displayName}
                        </Link>
                        <GuildBadge
                          level={also.guildLevel as import("@/components/GuildBadge").GuildLevelValue}
                          size={20}
                        />
                        {also.isFoundingMaker && (
                          <FoundingMakerBadge number={also.foundingMakerNumber} size={18} />
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                        {alsoRating && alsoRating.count > 0 && (
                          <span>
                            ★ {(Math.round(alsoRating.avg * 10) / 10).toFixed(1)} ({alsoRating.count})
                          </span>
                        )}
                        {(also.city || also.state) && (
                          <span>{[also.city, also.state].filter(Boolean).join(", ")}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex w-full items-center justify-between gap-2 border-t border-[#2C1F1A]/10 pt-2 sm:ml-auto sm:w-auto sm:justify-end sm:border-0 sm:pt-0">
                      {meDbId !== also.userId && (
                        <FollowButton
                          sellerProfileId={also.id}
                          initialFollowing={featuredFollowing.has(also.id)}
                          initialCount={featuredFollowerCounts.get(also.id) ?? 0}
                          size="sm"
                        />
                      )}
                      <Link
                        href={publicSellerPath(also.id, also.displayName)}
                        className="text-sm font-semibold text-neutral-800 underline-offset-4 transition-colors hover:text-amber-800 hover:underline"
                      >
                        Visit shop →
                      </Link>
                    </div>
                  </div>
                );
              })()}
            </ScrollSection>
          );
        })()}

        {/* ── From the Blog ────────────────────────────────────────────────── */}
        {recentBlogPosts.length > 0 && (
          <ScrollSection className="bg-amber-50/30 rounded-xl px-4 py-6 -mx-4">
            <div data-home-blog className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold font-display">From the Blog</h2>
              <Link href="/blog" className="text-sm font-semibold text-neutral-800 underline-offset-4 transition-colors hover:text-amber-800 hover:underline">
                Read more stories →
              </Link>
            </div>
            <ul className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {recentBlogPosts.map((p) => {
                const authorProfile = p.sellerProfile ?? p.author?.sellerProfile;
                const authorName = authorProfile?.displayName ?? p.author?.name ?? "Former author";
                const authorAvatar = authorProfile?.avatarImageUrl ?? p.author?.imageUrl ?? null;
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
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[p.type]}`}>
                            {BLOG_TYPE_LABELS[p.type]}
                          </span>
                          {p.readingTimeMinutes && (
                            <span className="text-xs text-stone-500">{p.readingTimeMinutes} min read</span>
                          )}
                        </div>
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

    </main>
  );
}
