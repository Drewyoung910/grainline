// src/app/seller/[id]/page.tsx
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
import { cache } from "react";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { safeJsonLd } from "@/lib/json-ld";
import { prisma } from "@/lib/db";
import DynamicMapCard from "@/components/DynamicMapCard";
import CustomOrderRequestForm from "@/components/CustomOrderRequestForm";
import ClickTracker from "@/components/ClickTracker";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import { Instagram, Facebook, Pinterest, TikTok, Globe, Hammer, MapPin } from "@/components/icons";
import GuildBadge from "@/components/GuildBadge";
import FoundingMakerBadge from "@/components/FoundingMakerBadge";
import FollowButton from "@/components/FollowButton";
import BlockReportButton from "@/components/BlockReportButton";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import SellerGallery from "@/components/SellerGallery";
import CoverLightbox from "@/components/CoverLightbox";
import SellerProfileViewTracker from "@/components/SellerProfileViewTracker";
import ListingCard from "@/components/ListingCard";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import ExpandableText from "@/components/ExpandableText";
import CustomerPhotosGallery from "@/components/CustomerPhotosGallery";
import LocalDate from "@/components/LocalDate";
import MediaImage from "@/components/MediaImage";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { publicListingDetailWhere, publicListingWhere } from "@/lib/listingVisibility";
import { isSupportedStripeAccountVersion } from "@/lib/sellerVisibility";
import { extractRouteId, publicSellerPath, publicSellerShopPath, routeSegmentWithSlug } from "@/lib/publicPaths";
import { truncateText } from "@/lib/sanitize";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { isFirstPartyMediaUrl, normalizePublicHttpsUrl } from "@/lib/urlValidation";
import { getCachedPublicSellerStats } from "@/lib/publicSellerStats";

const SOCIAL_LINK_ALLOWED_HOSTS = {
  Instagram: ["instagram.com"],
  Facebook: ["facebook.com", "fb.com"],
  Pinterest: ["pinterest.com"],
  TikTok: ["tiktok.com"],
} satisfies Record<string, string[]>;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const SELLER_PROFILE_LISTING_PREVIEW_SIZE = 9;

const sellerProfileListingCardSelect = {
  id: true,
  title: true,
  priceCents: true,
  currency: true,
  status: true,
  isPrivate: true,
  listingType: true,
  stockQuantity: true,
  photos: {
    orderBy: { sortOrder: "asc" },
    take: 1,
    select: { url: true, altText: true },
  },
} as const;

function safeSellerSocialUrl(value: string | null, allowedHosts?: readonly string[]) {
  const normalized = normalizePublicHttpsUrl(value, 2048);
  if (!normalized) return null;
  if (!allowedHosts) return normalized;
  const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  return allowedHosts.includes(host) ? normalized : null;
}

const getSellerProfileForPublicPage = cache(async (sellerId: string) =>
  prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      userId: true,
      displayName: true,
      bio: true,
      city: true,
      state: true,
      lat: true,
      lng: true,
      createdAt: true,
      radiusMeters: true,
      publicMapOptIn: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      workshopImageUrl: true,
      storyTitle: true,
      storyBody: true,
      instagramUrl: true,
      facebookUrl: true,
      pinterestUrl: true,
      tiktokUrl: true,
      websiteUrl: true,
      yearsInBusiness: true,
      acceptsCustomOrders: true,
      acceptingNewOrders: true,
      returnPolicy: true,
      customOrderPolicy: true,
      shippingPolicy: true,
      featuredListingIds: true,
      galleryImageUrls: true,
      galleryAltTexts: true,
      guildLevel: true,
      vacationMode: true,
      vacationReturnDate: true,
      vacationMessage: true,
      isFoundingMaker: true,
      foundingMakerNumber: true,
      chargesEnabled: true,
      stripeAccountVersion: true,
      user: { select: { imageUrl: true, banned: true, deletedAt: true } },
      faqs: { orderBy: { sortOrder: "asc" }, select: { id: true, question: true, answer: true } },
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
    },
  })
);

type PublicSellerProfile = NonNullable<Awaited<ReturnType<typeof getSellerProfileForPublicPage>>>;

function sellerIsPubliclyVisible(
  seller: Awaited<ReturnType<typeof getSellerProfileForPublicPage>>,
): seller is PublicSellerProfile {
  return Boolean(
    seller &&
      seller.chargesEnabled &&
      isSupportedStripeAccountVersion(seller.stripeAccountVersion) &&
      !seller.user?.banned &&
      !seller.user?.deletedAt,
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sellerId = extractRouteId(id);
  const seller = await getSellerProfileForPublicPage(sellerId);
  if (!sellerIsPubliclyVisible(seller)) return {};

  const name = seller.displayName ?? "Maker";
  const title = `${name} — Handmade Woodworking on Grainline`;
  const description =
    (seller.bio ? truncateText(seller.bio, 160) : null) ||
    seller.tagline ||
    `Shop handmade woodworking pieces by ${name} on Grainline`;

  const firstPhoto = await prisma.listing.findFirst({
    where: publicListingWhere({ sellerId }),
    select: { photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const img =
    seller.bannerImageUrl ||
    seller.avatarImageUrl ||
    seller.user?.imageUrl ||
    firstPhoto?.photos[0]?.url ||
    null;

  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      images: img ? [{ url: img }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: img ? [img] : undefined,
    },
    alternates: { canonical: `https://thegrainline.com${publicSellerPath(sellerId, name)}` },
  };
}

export default async function SellerPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sellerId = extractRouteId(id);

  const [seller, authResult] = await Promise.all([
    getSellerProfileForPublicPage(sellerId),
    auth(),
  ]);

  if (!seller) return notFound();
  if (seller.user?.banned || seller.user?.deletedAt) return notFound();

  // Current viewer
  const { userId } = authResult;
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }
  const isOwner = !!meId && seller.userId === meId;
  if (!isOwner && !sellerIsPubliclyVisible(seller)) return notFound();

  // Block check — return 404 if the viewer has blocked or been blocked by the seller
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (blockedUserIds.has(seller.userId)) {
    return notFound();
  }

  if (id !== routeSegmentWithSlug(seller.id, seller.displayName, "maker")) {
    permanentRedirect(publicSellerPath(seller.id, seller.displayName));
  }

  // Ensure numbers (handle Prisma Decimal/null)
  const lat = seller.lat != null ? Number(seller.lat) : null;
  const lng = seller.lng != null ? Number(seller.lng) : null;
  const radiusMeters =
    seller.radiusMeters != null ? Number(seller.radiusMeters) : null;

  const cityState = [seller.city, seller.state].filter(Boolean).join(", ");
  const nowMs = Date.now();

  const [
    [followerCount, isFollowing],
    latestBroadcast,
    sellerBlogPosts,
    listings,
    activePublicListingCount,
    sellerRatingMap,
    publicSellerStats,
    tagRows,
    customerPhotos,
    customerPhotoTotal,
  ] = await Promise.all([
    Promise.all([
      prisma.follow.count({ where: { sellerProfileId: seller.id } }),
      meId
        ? prisma.follow.findUnique({
            where: { followerId_sellerProfileId: { followerId: meId, sellerProfileId: seller.id } },
            select: { id: true },
          }).then((r) => r !== null)
        : Promise.resolve(false),
    ]),
    prisma.sellerBroadcast.findFirst({
      where: { sellerProfileId: seller.id },
      orderBy: { sentAt: "desc" },
      select: { message: true, sentAt: true, imageUrl: true },
    }),
    prisma.blogPost.findMany({
      where: publicBlogPostWhere({ sellerProfileId: seller.id }),
      orderBy: { publishedAt: "desc" },
      take: 3,
      select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, type: true },
    }),
    prisma.listing.findMany({
      where: publicListingWhere({ sellerId: seller.id }),
      select: sellerProfileListingCardSelect,
      orderBy: { updatedAt: "desc" },
      take: SELLER_PROFILE_LISTING_PREVIEW_SIZE,
    }),
    prisma.listing.count({ where: publicListingWhere({ sellerId: seller.id }) }),
    getSellerRatingMap([seller.id]),
    getCachedPublicSellerStats(seller.id),
    prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) AS count
      FROM "Listing" l, unnest(l.tags) AS tag
      WHERE l."sellerId" = ${seller.id}
        AND l.status = 'ACTIVE'
        AND l."isPrivate" = false
      GROUP BY tag
      ORDER BY COUNT(*) DESC, tag ASC
      LIMIT 8
    `,
    prisma.reviewPhoto.findMany({
      where: {
        review: {
          listing: publicListingDetailWhere({ sellerId: seller.id }),
          reviewer: { banned: false, deletedAt: null },
          ...(blockedUserIds.size > 0 ? { reviewerId: { notIn: [...blockedUserIds] } } : {}),
        },
      },
      orderBy: { review: { createdAt: "desc" } },
      take: 12,
      select: {
        id: true,
        url: true,
        altText: true,
        review: { select: { listingId: true, reviewer: { select: { id: true } }, listing: { select: { title: true } } } },
      },
    }),
    prisma.reviewPhoto.count({
      where: {
        review: {
          listing: publicListingDetailWhere({ sellerId: seller.id }),
          reviewer: { banned: false, deletedAt: null },
          ...(blockedUserIds.size > 0 ? { reviewerId: { notIn: [...blockedUserIds] } } : {}),
        },
      },
    }),
  ]);

  const broadcastAgeDays = latestBroadcast
    ? (nowMs - latestBroadcast.sentAt.getTime()) / MS_PER_DAY
    : null;

  // Fetch featured listings in order
  let featuredListings: typeof listings = [];
  if (seller.featuredListingIds && seller.featuredListingIds.length > 0) {
    const featuredRows = await prisma.listing.findMany({
      where: publicListingWhere({ sellerId: seller.id, id: { in: seller.featuredListingIds } }),
      select: sellerProfileListingCardSelect,
    });
    const featuredById = new Map(featuredRows.map((l) => [l.id, l]));
    featuredListings = seller.featuredListingIds
      .map((fid) => featuredById.get(fid))
      .filter((l): l is (typeof listings)[0] => l !== undefined);
  }

  // ── Seller-wide rating (across ALL their listings, including private) ───────
  const listingIds = listings.map((l) => l.id);

  // Saved set for current viewer
  const savedSet = new Set<string>();
  if (meId && listingIds.length > 0) {
    const favs = await prisma.favorite.findMany({
      where: { userId: meId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    for (const f of favs) savedSet.add(f.listingId);
  }

  const shopRating = sellerRatingMap.get(seller.id) ?? null;
  const { soldCount, avgShipDays } = publicSellerStats;

  const topTags = tagRows.map((r) => r.tag);
  const memberSinceYear = seller.createdAt.getFullYear();
  const isNewSeller = soldCount === 0 && (shopRating?.count ?? 0) === 0;

  const customerPhotoReviewerCount = new Set(customerPhotos.map((p) => p.review.reviewer.id)).size;

  // ── JSON-LD ─────────────────────────────────────────────────────────────────
  const hasStructuredAddress = Boolean(cityState);
  const businessLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": hasStructuredAddress ? "LocalBusiness" : "Organization",
    name: seller.displayName ?? "Maker",
    description: seller.bio ?? undefined,
    url: `https://thegrainline.com${publicSellerPath(seller.id, seller.displayName)}`,
    knowsAbout: "Handmade Woodworking",
    ...(hasStructuredAddress
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: seller.city ?? undefined,
            addressRegion: seller.state ?? undefined,
          },
        }
      : {}),
    ...(hasStructuredAddress && seller.publicMapOptIn && !radiusMeters && lat != null && lng != null
      ? { geo: { "@type": "GeoCoordinates", latitude: lat, longitude: lng } }
      : {}),
  };

  // Add aggregate rating to JSON-LD if reviews exist
  if (shopRating && shopRating.count > 0) {
    businessLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: (Math.round(shopRating.avg * 10) / 10).toFixed(1),
      reviewCount: shopRating.count,
    };
  }

  // Social links
  type SocialLink = { label: string; url: string; Icon: (p: { size?: number; className?: string }) => React.ReactElement };
  type SocialLinkCandidate = Omit<SocialLink, "url"> & { url: string | null };
  const socialLinks: SocialLink[] = (
    [
      { label: "Instagram", url: safeSellerSocialUrl(seller.instagramUrl, SOCIAL_LINK_ALLOWED_HOSTS.Instagram), Icon: Instagram },
      { label: "Facebook", url: safeSellerSocialUrl(seller.facebookUrl, SOCIAL_LINK_ALLOWED_HOSTS.Facebook), Icon: Facebook },
      { label: "Pinterest", url: safeSellerSocialUrl(seller.pinterestUrl, SOCIAL_LINK_ALLOWED_HOSTS.Pinterest), Icon: Pinterest },
      { label: "TikTok", url: safeSellerSocialUrl(seller.tiktokUrl, SOCIAL_LINK_ALLOWED_HOSTS.TikTok), Icon: TikTok },
      { label: "Website", url: safeSellerSocialUrl(seller.websiteUrl), Icon: Globe },
    ] satisfies SocialLinkCandidate[]
  ).filter((x): x is SocialLink => x.url !== null);

  const sameAs = socialLinks.map((link) => link.url);
  if (sameAs.length > 0) businessLd.sameAs = sameAs;

  const latestBroadcastImageUrl =
    latestBroadcast?.imageUrl && isFirstPartyMediaUrl(latestBroadcast.imageUrl)
      ? latestBroadcast.imageUrl
      : null;

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
      {!isOwner && <SellerProfileViewTracker sellerId={seller.id} />}

      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(businessLd) }}
      />

      {/* ── Vacation notice ──────────────────────────────────────────────── */}
      {seller.vacationMode && (
        <div className="border-b border-amber-300 bg-amber-50 px-6 sm:px-8 py-4">
          <p className="font-medium text-amber-900">This maker is currently on vacation and not accepting new orders.</p>
          {seller.vacationReturnDate && (
            <p className="text-amber-800 text-sm mt-0.5">
              Expected return: <LocalDate date={seller.vacationReturnDate} dateOnly />
            </p>
          )}
          {seller.vacationMessage && (
            <p className="text-amber-800 text-sm mt-0.5">{seller.vacationMessage}</p>
          )}
          <Link href="/browse" className="inline-block mt-2 text-sm text-amber-900 underline hover:text-amber-700">
            Browse other makers →
          </Link>
        </div>
      )}

      {/* ── Hero: banner + identity ─────────────────────────────────────── */}
      <section className="mt-4">
        <div className="relative aspect-[3/1]">
          <div className="absolute inset-0 rounded-2xl overflow-hidden">
            <MediaImage
              src={seller.bannerImageUrl}
              alt={`${seller.displayName} banner`}
              fetchPriority="high"
              className="w-full h-full object-cover"
              fallbackClassName="w-full h-full bg-gradient-to-r from-neutral-800 to-neutral-600"
            />
          </div>
          <div className="absolute bottom-0 left-6 sm:left-8 h-24 w-24 translate-y-1/2 overflow-hidden rounded-full bg-white ring-4 ring-neutral-200 shadow-sm">
            {seller.avatarImageUrl ?? seller.user?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={(seller.avatarImageUrl ?? seller.user?.imageUrl)!}
                alt={seller.displayName}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full bg-neutral-300" />
            )}
          </div>
        </div>

        <div className="px-2 sm:px-4 pt-16 pb-2 space-y-4">
          {/* Top row: name + badges (left), Back to Browse (right). */}
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
              <h1 className="text-2xl sm:text-3xl font-bold font-display">{seller.displayName}</h1>
              <GuildBadge level={seller.guildLevel} showLabel={true} size={32} />
              {seller.isFoundingMaker && (
                <FoundingMakerBadge number={seller.foundingMakerNumber} showLabel={true} size={26} />
              )}
            </div>
            <Link href="/browse" className="text-sm text-neutral-600 underline shrink-0 mt-1">
              ← Back to Browse
            </Link>
          </div>

          {seller.tagline && (
            <p className="text-base sm:text-lg text-neutral-700 italic max-w-3xl">{seller.tagline}</p>
          )}

          {/* Inline meta + stats in a single horizontal flow. Etsy-style:
              location · sold · rating · ship · years · member-since · pills.
              Saves vertical space and reads as a clean shop summary. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-neutral-700">
            {cityState && (
              <>
                <span className="flex items-center gap-1">
                  <MapPin size={14} className="shrink-0 text-neutral-500" />
                  {cityState}
                </span>
                <span className="text-neutral-300" aria-hidden="true">·</span>
              </>
            )}
            {!isNewSeller && soldCount > 0 && (
              <>
                <span><span className="font-semibold">{soldCount.toLocaleString("en-US")}</span>{" "}{soldCount === 1 ? "piece sold" : "pieces sold"}</span>
                <span className="text-neutral-300" aria-hidden="true">·</span>
              </>
            )}
            {shopRating && shopRating.count > 0 && (
              <>
                <span className="flex items-baseline gap-1">
                  <span className="font-semibold">{(Math.round(shopRating.avg * 10) / 10).toFixed(1)}</span>
                  <span className="text-amber-500">★</span>
                  <span className="text-neutral-500">({shopRating.count.toLocaleString("en-US")})</span>
                </span>
                <span className="text-neutral-300" aria-hidden="true">·</span>
              </>
            )}
            {avgShipDays != null && (
              <>
                <span><span className="font-semibold">Ships in {avgShipDays}</span>{" "}{avgShipDays === 1 ? "day" : "days"}</span>
                <span className="text-neutral-300" aria-hidden="true">·</span>
              </>
            )}
            {seller.yearsInBusiness != null && seller.yearsInBusiness > 0 && (
              <>
                <span><span className="font-semibold">{seller.yearsInBusiness}</span>{" "}{seller.yearsInBusiness === 1 ? "year crafting" : "years crafting"}</span>
                <span className="text-neutral-300" aria-hidden="true">·</span>
              </>
            )}
            <span className="text-neutral-600">Member since {memberSinceYear}</span>
            {seller.acceptsCustomOrders && (
              <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800 font-medium">Accepting custom orders</span>
            )}
            {!seller.acceptingNewOrders && (
              <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 font-medium">Not currently taking new orders</span>
            )}
          </div>

          {/* Bio with expand */}
          {seller.bio && (
            <ExpandableText text={seller.bio} clampLines={3} className="max-w-3xl" />
          )}

          {/* Action row — Following first (left-most), then Message Maker,
              Custom Piece, View all listings. All dark cream for a unified
              secondary-button look. */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {meId !== seller.userId && (
              <>
                <FollowButton
                  sellerProfileId={seller.id}
                  sellerUserId={seller.userId}
                  initialFollowing={isFollowing}
                  initialCount={followerCount}
                  variant="cream"
                />
                <Link
                  href={meId ? `/messages/new?to=${seller.userId}` : `/sign-in?redirect_url=${encodeURIComponent(publicSellerPath(seller.id, seller.displayName))}`}
                  className="inline-flex items-center justify-center rounded-md bg-[#EFEAE0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
                >
                  Message Maker
                </Link>
                {seller.acceptsCustomOrders && (
                  meId ? (
                    <CustomOrderRequestForm
                      sellerUserId={seller.userId}
                      sellerName={seller.displayName}
                      triggerLabel="Request a Custom Piece"
                      triggerClassName="inline-flex items-center gap-2 rounded-md bg-[#EFEAE0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
                    />
                  ) : (
                    <Link
                      href={`/sign-in?redirect_url=${encodeURIComponent(publicSellerPath(seller.id, seller.displayName))}`}
                      className="inline-flex items-center gap-2 rounded-md bg-[#EFEAE0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
                    >
                      <Hammer size={15} />
                      Request a Custom Piece
                    </Link>
                  )
                )}
                <Link
                  href={publicSellerShopPath(seller.id, seller.displayName)}
                  className="inline-flex items-center rounded-md bg-[#EFEAE0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors"
                >
                  View all listings
                </Link>
              </>
            )}

            {socialLinks.length > 0 && (
              <div className="flex flex-wrap gap-3 items-center ml-1">
                {socialLinks.map(({ label, url, Icon }) => (
                  <a
                    key={label}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={label}
                    className="text-neutral-500 hover:text-neutral-900"
                  >
                    <Icon size={20} />
                  </a>
                ))}
              </div>
            )}

            {meId && meId !== seller.userId && (
              <span className="ml-auto">
                <BlockReportButton
                  targetUserId={seller.userId}
                  targetName={seller.displayName ?? "this maker"}
                  targetType="SELLER"
                  targetId={seller.id}
                />
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Body: full-width rhythm ─────────────────────────────────────── */}
      <div className="mt-6 pb-12 px-2 sm:px-4">
        <div className="min-w-0 space-y-10">

          {/* Latest broadcast */}
          {latestBroadcast && broadcastAgeDays !== null && broadcastAgeDays < 30 && (
            <section className="rounded-2xl bg-amber-50 border border-amber-100 p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
                Shop update · <LocalDate date={latestBroadcast.sentAt} />
              </div>
              <p className="text-sm text-neutral-800 whitespace-pre-line">{latestBroadcast.message}</p>
              {latestBroadcastImageUrl && (
                <MediaImage
                  src={latestBroadcastImageUrl}
                  alt="Update"
                  className="mt-3 w-full max-h-48 object-cover rounded-md"
                  fallbackClassName="mt-3 h-32 w-full bg-gradient-to-br from-amber-50 to-stone-100 rounded-md"
                />
              )}
            </section>
          )}

          {/* Featured Work: asymmetric grid */}
          {(() => {
            // Use seller-curated featured listings if set; otherwise fall back to
            // most recent 3 active listings so the section always renders for
            // established sellers.
            const fallbackFeatured =
              featuredListings.length > 0
                ? featuredListings
                : listings.filter((l) => l.status === "ACTIVE" && !l.isPrivate).slice(0, 3);
            if (fallbackFeatured.length === 0) return null;
            const sellerChip = {
              id: seller.id,
              displayName: seller.displayName ?? null,
              avatarImageUrl: seller.avatarImageUrl ?? seller.user?.imageUrl ?? null,
              guildLevel: seller.guildLevel ?? null,
              city: seller.city ?? null,
              state: seller.state ?? null,
              acceptingNewOrders: seller.acceptingNewOrders ?? null,
            };
            const wrap = (l: (typeof listings)[number]) => ({
              id: l.id,
              title: l.title,
              priceCents: l.priceCents,
              currency: l.currency,
              status: l.status,
              listingType: l.listingType,
              stockQuantity: l.stockQuantity ?? null,
              photoUrl: l.photos[0]?.url ?? null,
              photoAltText: l.photos[0]?.altText ?? null,
              seller: sellerChip,
              rating: null,
            });
            if (fallbackFeatured.length >= 3) {
              const [hero, second, third] = fallbackFeatured;
              return (
                <section>
                  <div className="flex items-baseline justify-between mb-4">
                    <h2 className="text-xl sm:text-2xl font-display font-semibold">Featured Work</h2>
                  </div>
                  {/* Mobile: horizontal scroll with fade. Desktop: asymmetric 3-col grid. */}
                  <ScrollFadeRow hideAtBreakpoint="lg" className="overflow-x-auto -mx-4 px-4 lg:-mx-0 lg:px-0 lg:overflow-visible">
                    <ul className="flex gap-4 snap-x snap-mandatory pb-4 lg:grid lg:grid-cols-3 lg:grid-rows-2 lg:gap-5 lg:pb-0">
                      <li className="w-[220px] flex-none snap-start lg:w-auto lg:col-span-2 lg:row-span-2 transition-transform hover:-translate-y-1 duration-200">
                        <ClickTracker listingId={hero.id}>
                          <ListingCard listing={wrap(hero)} initialSaved={savedSet.has(hero.id)} variant="grid" />
                        </ClickTracker>
                      </li>
                      <li className="w-[220px] flex-none snap-start lg:w-auto transition-transform hover:-translate-y-1 duration-200">
                        <ClickTracker listingId={second.id}>
                          <ListingCard listing={wrap(second)} initialSaved={savedSet.has(second.id)} variant="grid" />
                        </ClickTracker>
                      </li>
                      <li className="w-[220px] flex-none snap-start lg:w-auto transition-transform hover:-translate-y-1 duration-200">
                        <ClickTracker listingId={third.id}>
                          <ListingCard listing={wrap(third)} initialSaved={savedSet.has(third.id)} variant="grid" />
                        </ClickTracker>
                      </li>
                    </ul>
                  </ScrollFadeRow>
                </section>
              );
            }
            if (fallbackFeatured.length === 2) {
              return (
                <section>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Featured Work</h2>
                  <ScrollFadeRow mobileOnly className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0 sm:overflow-visible">
                    <ul className="flex gap-4 snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-2 sm:gap-5 sm:pb-0">
                      {fallbackFeatured.map((l) => (
                        <li key={l.id} className="w-[220px] flex-none snap-start sm:w-auto transition-transform hover:-translate-y-1 duration-200">
                          <ClickTracker listingId={l.id}>
                            <ListingCard listing={wrap(l)} initialSaved={savedSet.has(l.id)} variant="grid" />
                          </ClickTracker>
                        </li>
                      ))}
                    </ul>
                  </ScrollFadeRow>
                </section>
              );
            }
            // 1 listing — small card aligned left, no scroll, no big stretched photo
            return (
              <section>
                <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Featured Work</h2>
                <div className="w-[240px] sm:w-[280px] transition-transform hover:-translate-y-1 duration-200">
                  <ClickTracker listingId={fallbackFeatured[0].id}>
                    <ListingCard listing={wrap(fallbackFeatured[0])} initialSaved={savedSet.has(fallbackFeatured[0].id)} variant="grid" />
                  </ClickTracker>
                </div>
              </section>
            );
          })()}

          {/* Story | Workshop two-column */}
          {(seller.storyTitle || seller.storyBody || seller.bio || seller.workshopImageUrl) && (
            <section className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-6 lg:gap-10 items-start">
              {(seller.storyTitle || seller.storyBody || seller.bio) && (
                <div>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold mb-3">
                    {seller.storyTitle || "About"}
                  </h2>
                  {seller.storyBody && (
                    <p className="text-neutral-700 whitespace-pre-line leading-relaxed">{seller.storyBody}</p>
                  )}
                  {seller.bio && !seller.storyBody && (
                    <p className="text-neutral-700 whitespace-pre-line leading-relaxed">{seller.bio}</p>
                  )}
                  {seller.bio && seller.storyBody && seller.bio !== seller.storyBody && (
                    <p className="text-neutral-700 whitespace-pre-line leading-relaxed mt-4 pt-4 border-t border-neutral-100">
                      {seller.bio}
                    </p>
                  )}
                </div>
              )}
              {seller.workshopImageUrl && (
                <figure className="lg:order-last">
                  <div className="aspect-[3/2] overflow-hidden rounded-2xl ring-1 ring-neutral-200 shadow-sm">
                    <CoverLightbox
                      src={seller.workshopImageUrl}
                      alt={`${seller.displayName} workshop`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  {cityState && (
                    <figcaption className="text-xs text-neutral-500 mt-2 italic">
                      The shop in {cityState}
                    </figcaption>
                  )}
                </figure>
              )}
            </section>
          )}

          {/* Customer photos masonry */}
          {customerPhotos.length > 0 && (
            <section>
              <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
                <div>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold">Customer photos</h2>
                  {customerPhotoTotal > 0 && (
                    <p className="text-sm text-neutral-500 mt-1">
                      {customerPhotoTotal.toLocaleString("en-US")} {customerPhotoTotal === 1 ? "photo" : "photos"}
                      {customerPhotoReviewerCount > 0 && (
                        <> from {customerPhotoReviewerCount.toLocaleString("en-US")} {customerPhotoReviewerCount === 1 ? "buyer" : "buyers"}</>
                      )}
                    </p>
                  )}
                </div>
                {customerPhotoTotal > 12 && (
                  <Link
                    href={`/seller/${seller.id}/customer-photos`}
                    className="text-sm text-amber-700 hover:underline"
                  >
                    View all customer photos →
                  </Link>
                )}
              </div>
              <CustomerPhotosGallery
                photos={customerPhotos.map((p) => ({
                  id: p.id,
                  url: p.url,
                  altText: p.altText,
                  listingId: p.review.listingId,
                  listingTitle: p.review.listing?.title ?? null,
                }))}
              />
            </section>
          )}

          {/* All Listings */}
          <section>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-xl sm:text-2xl font-display font-semibold">All Listings</h2>
              {activePublicListingCount > 0 && (
                <Link
                  href={publicSellerShopPath(seller.id, seller.displayName)}
                  className="text-sm text-amber-700 hover:underline"
                >
                  See all {activePublicListingCount} {activePublicListingCount === 1 ? "piece" : "pieces"} →
                </Link>
              )}
            </div>

            {/* Tag filter row — desktop only. Mobile has limited horizontal
                space and the filter chips were adding visual noise; on mobile
                the user can filter from the dedicated shop page. */}
            {topTags.length >= 3 && (
              <div className="hidden sm:flex flex-wrap items-center gap-2 mb-5">
                <span className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mr-1">
                  Filter:
                </span>
                {topTags.map((tag) => (
                  <Link
                    key={tag}
                    href={`${publicSellerShopPath(seller.id, seller.displayName)}?tag=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-stone-100 hover:bg-stone-200 text-neutral-700 px-3 py-1 text-xs transition-colors"
                  >
                    {tag.replace(/[-_]/g, " ")}
                  </Link>
                ))}
              </div>
            )}

            {listings.length === 0 ? (
              <div className="card-section p-6 text-neutral-600 bg-white">No listings yet.</div>
            ) : (
              <ScrollFadeRow mobileOnly className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0 sm:overflow-visible">
                <ul className="flex gap-4 snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-2 sm:pb-0 md:grid-cols-3 sm:gap-6">
                  {listings.map((l) => (
                    <ClickTracker key={l.id} listingId={l.id} className="w-[220px] flex-none snap-start sm:w-auto transition-transform hover:-translate-y-1 duration-200">
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
                          seller: {
                            id: seller.id,
                            displayName: seller.displayName ?? null,
                            avatarImageUrl: seller.avatarImageUrl ?? seller.user?.imageUrl ?? null,
                            guildLevel: seller.guildLevel ?? null,
                            city: seller.city ?? null,
                            state: seller.state ?? null,
                            acceptingNewOrders: seller.acceptingNewOrders ?? null,
                          },
                          rating: null,
                        }}
                        initialSaved={savedSet.has(l.id)}
                        variant="grid"
                      />
                    </ClickTracker>
                  ))}
                </ul>
              </ScrollFadeRow>
            )}
            {activePublicListingCount > SELLER_PROFILE_LISTING_PREVIEW_SIZE ? (
              <div className="mt-5 text-center">
                <Link
                  href={publicSellerShopPath(seller.id, seller.displayName)}
                  className="inline-block rounded-md border border-neutral-300 px-5 py-2 text-sm font-medium hover:bg-neutral-50"
                >
                  See all {activePublicListingCount} pieces →
                </Link>
              </div>
            ) : null}
          </section>

          {/* Workshop gallery (full width, separate from story workshop photo) */}
          {seller.galleryImageUrls && seller.galleryImageUrls.length > 0 && (
            <section>
              <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">From the Workshop</h2>
              <SellerGallery
                workshopImageUrl={null}
                images={seller.galleryImageUrls}
                imageAltTexts={seller.galleryAltTexts ?? []}
              />
            </section>
          )}

          {/* Pickup area — full-width when set, with a proper heading */}
          {lat != null && lng != null && (
            <section>
              <div className="mb-4">
                <h2 className="text-xl sm:text-2xl font-display font-semibold">Visit this maker</h2>
                <p className="text-sm text-neutral-500 mt-1">
                  {radiusMeters
                    ? `Approximate area${cityState ? ` near ${cityState}` : ""}. Exact pickup details shared after purchase.`
                    : `Exact pickup point${cityState ? ` in ${cityState}` : ""}. Pickup available at checkout.`}
                </p>
              </div>
              <div className="rounded-2xl overflow-hidden ring-1 ring-stone-300/70 shadow-sm">
                <DynamicMapCard
                  lat={lat}
                  lng={lng}
                  label={cityState || seller.displayName || "Pickup area"}
                  radiusMeters={radiusMeters ?? null}
                  showPinWithRadius={false}
                  className="h-72 sm:h-96 w-full"
                />
              </div>
            </section>
          )}

          {/* Policies + FAQ two-column */}
          {(seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy || seller.faqs.length > 0) && (
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {(seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy) && (
                <div className="overflow-hidden rounded-lg border border-stone-200/60 bg-[#EFEAE0] shadow-sm">
                  <h2 className="text-lg font-display font-semibold px-5 py-3 border-b border-stone-200/60">Shop Policies</h2>
                  {seller.returnPolicy && (
                    <details className="border-b border-stone-200/60 last:border-b-0">
                      <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-[#E3DCCB]">Return Policy</summary>
                      <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.returnPolicy}</p>
                    </details>
                  )}
                  {seller.customOrderPolicy && (
                    <details className="border-b border-stone-200/60 last:border-b-0">
                      <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-[#E3DCCB]">Custom Order Policy</summary>
                      <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.customOrderPolicy}</p>
                    </details>
                  )}
                  {seller.shippingPolicy && (
                    <details className="border-b border-stone-200/60 last:border-b-0">
                      <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-[#E3DCCB]">Shipping Policy</summary>
                      <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.shippingPolicy}</p>
                    </details>
                  )}
                </div>
              )}
              {seller.faqs.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-stone-200/60 bg-[#EFEAE0] shadow-sm">
                  <h2 className="text-lg font-display font-semibold px-5 py-3 border-b border-stone-200/60">FAQs</h2>
                  {seller.faqs.map((faq) => (
                    <details key={faq.id} className="border-b border-stone-200/60 last:border-b-0">
                      <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-[#E3DCCB]">{faq.question}</summary>
                      <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{faq.answer}</p>
                    </details>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Blog posts */}
          {sellerBlogPosts.length > 0 && (
            <section>
              <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Stories from the Workshop</h2>
              <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
                {sellerBlogPosts.map((p) => (
                  <li key={p.slug} className="card-listing min-w-[220px] flex-none snap-start sm:min-w-0 transition-transform hover:-translate-y-1 duration-200">
                    <Link href={`/blog/${p.slug}`} className="block">
                      <div className="aspect-[16/9] bg-neutral-100 overflow-hidden">
                        {p.coverImageUrl ? (
                          <MediaImage
                            src={p.coverImageUrl}
                            alt={p.title}
                            className="w-full h-full object-cover"
                            fallbackClassName="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100"
                          />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100" />
                        )}
                      </div>
                      <div className="p-3 space-y-1">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BLOG_TYPE_COLORS[p.type]}`}>
                          {BLOG_TYPE_LABELS[p.type]}
                        </span>
                        <div className="font-medium text-sm line-clamp-2 mt-1">{p.title}</div>
                        {p.excerpt && <p className="text-xs text-neutral-500 line-clamp-2">{p.excerpt}</p>}
                        {p.publishedAt && (
                          <div className="text-xs text-neutral-500">
                            <LocalDate date={p.publishedAt} />
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* More from city — small footer link block, bottom-left. Hidden
              when the only available metro looks like a county/parish (older
              auto-created metros may have used Nominatim's county fallback). */}
          {(() => {
            const candidate = seller.cityMetro ?? seller.metro;
            if (!candidate) return null;
            if (/\b(county|parish)\b/i.test(candidate.name)) return null;
            return (
              <section className="pt-6 mt-2 border-t border-neutral-200/60">
                <div className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-2">
                  More from {candidate.name}, {candidate.state}
                </div>
                <div className="flex flex-col gap-1 text-sm">
                  <Link href={`/makers/${candidate.slug}`} className="text-amber-700 hover:underline">
                    Other makers in {candidate.name} →
                  </Link>
                  <Link href={`/browse/${candidate.slug}`} className="text-amber-700 hover:underline">
                    Browse {candidate.name} listings →
                  </Link>
                </div>
              </section>
            );
          })()}
        </div>

      </div>
    </main>
  );
}
