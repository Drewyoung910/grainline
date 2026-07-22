// src/app/listing/[id]/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { cache } from "react";
import FavoriteButton from "@/components/FavoriteButton";
import DynamicMapCard from "@/components/DynamicMapCard";
import type { Metadata } from "next";
import ReviewsSection from "@/components/ReviewsSection";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import ListingPurchasePanel from "@/components/ListingPurchasePanel";
import ListingViewTracker from "@/components/ListingViewTracker";
import RecentlyViewedTracker from "@/components/RecentlyViewedTracker";
import { CATEGORY_LABELS } from "@/lib/categories";
import CustomOrderRequestForm from "@/components/CustomOrderRequestForm";
import SimilarItems from "@/components/SimilarItems";
import SimilarMakers from "@/components/SimilarMakers";
import GuildBadge from "@/components/GuildBadge";
import FoundingMakerBadge from "@/components/FoundingMakerBadge";
import FollowButton from "@/components/FollowButton";
import { safeJsonLd } from "@/lib/json-ld";
import ListingGallery from "@/components/ListingGallery";
import DescriptionExpander from "@/components/DescriptionExpander";
import BlockReportButton from "@/components/BlockReportButton";
import { Wrench } from "@/components/icons";
import { canViewListingDetail, isPublicListingDetail, publicListingWhere } from "@/lib/listingVisibility";
import { extractRouteId, publicListingPath, publicSellerPath, publicTagPath, routeSegmentWithSlug } from "@/lib/publicPaths";
import { truncateText } from "@/lib/sanitize";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";
import { avatarInitials } from "@/lib/avatarInitials";
import { DEFAULT_CURRENCY, formatCurrencyCents, formatCurrencyMinorUnitAmount } from "@/lib/money";

function siteUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(path, base).toString();
}

const getListingForDetailPage = cache(async (listingId: string) =>
  prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      id: true,
      title: true,
      description: true,
      metaDescription: true,
      priceCents: true,
      currency: true,
      status: true,
      isPrivate: true,
      reservedForUserId: true,
      listingType: true,
      stockQuantity: true,
      shipsWithinDays: true,
      processingTimeMinDays: true,
      processingTimeMaxDays: true,
      category: true,
      tags: true,
      materials: true,
      productLengthIn: true,
      productWidthIn: true,
      productHeightIn: true,
      sellerId: true,
      photos: { orderBy: { sortOrder: "asc" } },
      seller: {
        select: {
          id: true,
          userId: true,
          displayName: true,
          city: true,
          state: true,
          lat: true,
          lng: true,
          radiusMeters: true,
          allowLocalPickup: true,
          chargesEnabled: true,
          stripeAccountVersion: true,
          vacationMode: true,
          acceptingNewOrders: true,
          acceptsCustomOrders: true,
          offersGiftWrapping: true,
          giftWrappingPriceCents: true,
          returnPolicy: true,
          shippingPolicy: true,
          customOrderPolicy: true,
          tagline: true,
          avatarImageUrl: true,
          guildLevel: true,
          isFoundingMaker: true,
          foundingMakerNumber: true,
          user: { select: { imageUrl: true, banned: true, deletedAt: true } },
        },
      },
      metroId: true,
      cityMetroId: true,
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
      variantGroups: {
        orderBy: { sortOrder: "asc" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      },
    },
  })
);

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[]>> }
): Promise<Metadata> {
  const { id } = await params;
  const listingId = extractRouteId(id);
  const sp = await searchParams;
  if (sp.preview === "1" || sp.preview === "admin") {
    return { robots: { index: false, follow: false } };
  }
  const listing = await getListingForDetailPage(listingId);
  if (!listing) notFound();
  if (!isPublicListingDetail(listing)) {
    // The page performs viewer-aware authorization for seller previews and
    // buyer-reserved private listings. Metadata cannot reject every private
    // row first or those authorized viewers receive a false 404. Keep this
    // response generic so an unauthorized request learns no private title,
    // seller, price, image, or canonical URL; the page still returns 404.
    return {
      title: { absolute: "Private listing — Grainline" },
      robots: { index: false, follow: false },
    };
  }
  const sellerName = listing.seller.displayName ?? "Maker";
  const title = `${listing.title} by ${sellerName}`;
  const desc = listing.metaDescription || truncateText(listing.description ?? "", 160);
  const img = listing.photos[0]?.url;
  const price = formatCurrencyMinorUnitAmount(listing.priceCents, listing.currency);
  const currency = (listing.currency || DEFAULT_CURRENCY).toUpperCase();

  return {
    title: { absolute: `${title} — Grainline` },
    description: desc,
    openGraph: {
      title,
      description: desc,
      images: img ? [{ url: img }] : undefined,
      url: siteUrl(publicListingPath(listingId, listing.title)),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: desc,
      images: img ? [img] : undefined,
    },
    other: {
      "product:price:amount": price,
      "product:price:currency": currency,
    },
    alternates: { canonical: `https://thegrainline.com${publicListingPath(listingId, listing.title)}` },
  };
}

function quarterRoundStars(n: number) {
  const q = Math.min(5, Math.max(0, Math.round(n * 4) / 4));
  const display = Math.round(n * 10) / 10;
  return { quarter: q, display };
}

function StarDisplay({ value }: { value: number }) {
  const q = Math.min(5, Math.max(0, Math.round(value * 4) / 4));
  return (
    <div
      className="relative leading-none inline-block"
      role="img"
      aria-label={`${value.toFixed(1)} out of 5 stars`}
    >
      <div className="text-neutral-300" aria-hidden="true">★★★★★</div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${(q / 5) * 100}%` }}
      >
        <div className="text-amber-500" aria-hidden="true">★★★★★</div>
      </div>
    </div>
  );
}

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rsort?: string; redit?: string; preview?: string }>;
}) {
  const { id } = await params;
  const listingId = extractRouteId(id);
  const listingPromise = getListingForDetailPage(listingId);

  const sp = await searchParams;
  const sortKey = (sp.rsort as "top" | "new" | "rating" | "photos") ?? "top";
  const editingMine = sp.redit === "1";

  const { userId } = await auth();
  let me: { id: string; role: string; banned: boolean; deletedAt: Date | null } | null = null;
  let meId: string | null = null;
  if (userId) {
    me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, role: true, banned: true, deletedAt: true },
    });
    meId = me?.id ?? null;
  }
  const blockedUserIds = await getBlockedUserIdsFor(meId);

  const listing = await listingPromise;
  if (!listing) return notFound();

  // Preview mode: seller can view their own listing regardless of status/chargesEnabled
  const viewerIsSeller = !!meId && listing.seller.userId === meId;
  const staffPreviewRequested = sp.preview === "admin";
  const staffPreview =
    sp.preview === "admin" &&
    !!me &&
    !me.banned &&
    !me.deletedAt &&
    (me.role === "ADMIN" || me.role === "EMPLOYEE");
  const isPreview = (sp.preview === "1" && viewerIsSeller) || staffPreview;

  if (!canViewListingDetail(listing, {
    dbUserId: meId,
    clerkUserId: userId,
    preview: sp.preview === "1",
    staffPreview: staffPreviewRequested,
    role: me?.role,
    banned: me?.banned,
    deletedAt: me?.deletedAt,
  })) {
    return notFound();
  }

  // Block filter — return 404 if the viewer has blocked or been blocked by the seller
  if (!isPreview && blockedUserIds.has(listing.seller.userId)) {
    return notFound();
  }

  if (!isPreview && !editingMine && id !== routeSegmentWithSlug(listing.id, listing.title, "listing")) {
    permanentRedirect(publicListingPath(listing.id, listing.title));
  }

  const isOutOfStock =
    listing.status === "SOLD_OUT" ||
    (listing.listingType === "IN_STOCK" && (listing.stockQuantity ?? 0) <= 0);
  const canSubscribeForStockNotification = listing.listingType === "IN_STOCK" && isOutOfStock;
  const blockedReviewerFilter =
    blockedUserIds.size > 0 ? { reviewerId: { notIn: [...blockedUserIds] } } : {};
  const visibleListingReviewWhere = {
    listingId,
    reviewer: { banned: false, deletedAt: null },
    ...blockedReviewerFilter,
  };

  const [
    ratingAgg,
    sellerRatingMap,
    moreFromSeller,
    topReviews,
    favoriteRow,
    sellerFollowerCount,
    isFollowingSeller,
    stockNotificationRow,
  ] = await Promise.all([
    prisma.review.aggregate({
      where: visibleListingReviewWhere,
      _avg: { ratingX2: true },
      _count: { _all: true },
    }),
    getSellerRatingMap([listing.sellerId]),
    prisma.listing.findMany({
      where: publicListingWhere({
        sellerId: listing.sellerId,
        id: { not: listing.id },
      }),
      orderBy: [{ qualityScore: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 4,
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    }),
    prisma.review.findMany({
      where: visibleListingReviewWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: {
        id: true,
        ratingX2: true,
        comment: true,
        createdAt: true,
        reviewer: { select: { name: true } },
      },
    }),
    meId
      ? prisma.favorite.findFirst({
          where: { userId: meId, listingId },
          select: { userId: true },
        })
      : Promise.resolve(null),
    prisma.follow.count({ where: { sellerProfileId: listing.sellerId } }),
    meId
      ? prisma.follow
          .findUnique({
            where: {
              followerId_sellerProfileId: {
                followerId: meId,
                sellerProfileId: listing.sellerId,
              },
            },
            select: { id: true },
          })
          .then((r) => r !== null)
      : Promise.resolve(false),
    meId && canSubscribeForStockNotification
      ? prisma.stockNotification.findUnique({
          where: { listingId_userId: { listingId, userId: meId } },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  const avgStarsRaw = ratingAgg._avg.ratingX2 ? ratingAgg._avg.ratingX2 / 2 : null;
  const countReviews = ratingAgg._count._all || 0;
  const stars = avgStarsRaw != null ? quarterRoundStars(avgStarsRaw) : null;

  const sellerRating = sellerRatingMap.get(listing.sellerId) ?? null;
  const sellerAvgRaw = sellerRating && sellerRating.count > 0 ? sellerRating.avg : null;
  const sellerReviewCount = sellerRating?.count ?? 0;
  const sellerStars = sellerAvgRaw != null ? quarterRoundStars(sellerAvgRaw) : null;

  const isFavorited = favoriteRow !== null;
  const isNotified = stockNotificationRow !== null;

  // Saved state for the "More from this maker" cards so their hearts render
  // filled correctly for signed-in viewers (bounded: ≤4 ids, indexed lookup).
  const moreFromSavedIds =
    meId && moreFromSeller.length > 0
      ? new Set(
          (
            await prisma.favorite.findMany({
              where: { userId: meId, listingId: { in: moreFromSeller.map((ml) => ml.id) } },
              select: { listingId: true },
            })
          ).map((f) => f.listingId),
        )
      : new Set<string>();

  const sellerName = listing.seller.displayName ?? "Maker";
  const sellerHref = publicSellerPath(listing.sellerId, sellerName);
  const sellerAvatar = listing.seller.avatarImageUrl ?? listing.seller.user?.imageUrl ?? null;

  const sellerUserId = listing.seller.userId;

  const initials = avatarInitials(sellerName, "S");

  const lat = listing.seller.lat != null ? Number(listing.seller.lat) : null;
  const lng = listing.seller.lng != null ? Number(listing.seller.lng) : null;
  const radius = Number(listing.seller.radiusMeters ?? 0);
  const cityState = [listing.seller.city, listing.seller.state].filter(Boolean).join(", ");
  const showPickupMap = listing.seller.allowLocalPickup && lat != null && lng != null;

  const signedInMessageHref =
    sellerUserId
      ? `/messages/new?to=${encodeURIComponent(sellerUserId)}&listing=${encodeURIComponent(listingId)}`
      : "#";
  const hideMessage = !!meId && !!sellerUserId && meId === sellerUserId;

  const canReplyClerkId = viewerIsSeller ? userId : null;

  const isActive = listing.status === "ACTIVE";
  const isOwnListing = viewerIsSeller;

  const isPrivate = listing.isPrivate;
  const reservedForMe = isPrivate && !!meId && listing.reservedForUserId === meId;
  const reservedForOther = isPrivate && (!meId || listing.reservedForUserId !== meId);

  const canBuy =
    isActive &&
    !isOwnListing &&
    !isOutOfStock &&
    !reservedForOther &&
    listing.seller.chargesEnabled &&
    listing.seller.acceptingNewOrders !== false;

  // Processing time label
  let processingLabel: string | null = null;
  if (listing.listingType === "IN_STOCK" && !isOutOfStock && listing.shipsWithinDays != null) {
    processingLabel = `Ships within ${listing.shipsWithinDays} day${listing.shipsWithinDays !== 1 ? "s" : ""}`;
  } else if (listing.listingType === "MADE_TO_ORDER") {
    if (listing.processingTimeMinDays != null && listing.processingTimeMaxDays != null) {
      processingLabel = `Ships in ${listing.processingTimeMinDays}–${listing.processingTimeMaxDays} days`;
    } else if (listing.processingTimeMaxDays != null) {
      processingLabel = `Ships in up to ${listing.processingTimeMaxDays} days`;
    }
  }

  const productLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description,
    image: listing.photos.map((p) => p.url).slice(0, 8),
    sku: listing.id,
    brand: { "@type": "Brand", name: sellerName },
    url: siteUrl(publicListingPath(listing.id, listing.title)),
    offers: {
      "@type": "Offer",
      priceCurrency: (listing.currency || DEFAULT_CURRENCY).toUpperCase(),
      price: formatCurrencyMinorUnitAmount(listing.priceCents, listing.currency),
      priceValidUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      availability: isOutOfStock
        ? "https://schema.org/OutOfStock"
        : listing.listingType === "MADE_TO_ORDER"
        ? "https://schema.org/PreOrder"
        : "https://schema.org/InStock",
      url: siteUrl(publicListingPath(listing.id, listing.title)),
      seller: { "@type": "Organization", name: sellerName, url: `https://thegrainline.com${sellerHref}` },
    },
  };
  if (countReviews > 0 && avgStarsRaw != null) {
    // Listing-specific rating
    productLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: (Math.round(avgStarsRaw * 10) / 10).toFixed(1),
      reviewCount: countReviews,
    };
  } else if (sellerAvgRaw != null && sellerReviewCount > 0) {
    // Fallback to seller rating
    productLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: sellerAvgRaw.toFixed(1),
      reviewCount: sellerReviewCount,
    };
  }
  if (topReviews.length > 0) {
    productLd.review = topReviews.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.reviewer.name ?? "Grainline Buyer" },
      datePublished: r.createdAt.toISOString(),
      reviewRating: {
        "@type": "Rating",
        ratingValue: (r.ratingX2 / 2).toFixed(1),
        bestRating: "5",
      },
      ...(r.comment ? { reviewBody: truncateText(r.comment, 200) } : {}),
    }));
  }

  const categoryParam = listing.category ? listing.category.toLowerCase() : null;
  const breadcrumbItems: { "@type": string; position: number; name: string; item: string }[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://thegrainline.com" },
  ];
  if (listing.category && categoryParam) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: CATEGORY_LABELS[listing.category] ?? listing.category,
      item: `https://thegrainline.com/browse?category=${categoryParam}`,
    });
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: listing.title,
      item: `https://thegrainline.com${publicListingPath(listing.id, listing.title)}`,
    });
  } else {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: listing.title,
      item: `https://thegrainline.com${publicListingPath(listing.id, listing.title)}`,
    });
  }
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };

  return (
    <div className="bg-[#F7F5F0] min-h-[100svh]">
    {isPreview && (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-800 text-center">
        {listing.status === "PENDING_REVIEW"
          ? "Under review — your listing will go live once our team approves it. This is the buyer-facing preview."
          : "Preview mode — this is how your listing appears to buyers. It is not yet published."}
      </div>
    )}
    <main className="max-w-[1600px] mx-auto overflow-x-hidden px-4 sm:px-6 lg:px-8 pb-16 pt-6">
      <ListingViewTracker listingId={listingId} />
      <RecentlyViewedTracker listingId={listingId} />
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(productLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }}
      />

      {/* ── Breadcrumb ───────────────────────────────────────────────────── */}
      <nav className="mb-4 text-sm text-neutral-500 flex items-center gap-1 flex-wrap">
        <Link href="/browse" className="hover:underline">Browse</Link>
        {listing.category && (
          <>
            <span>›</span>
            <Link
              href={`/browse?category=${listing.category}`}
              className="hover:underline"
            >
              {CATEGORY_LABELS[listing.category] ?? listing.category}
            </Link>
          </>
        )}
        <span>›</span>
        <span className="text-neutral-800 truncate max-w-[200px]">{listing.title}</span>
      </nav>

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <div className="grid min-w-0 gap-8 mb-10 lg:grid-cols-2">
        {/* Left: gallery */}
        <div className="relative min-w-0">
          {/* Favorite button overlaid */}
          <FavoriteButton listingId={listingId} initialSaved={isFavorited} size={22} />
          <ListingGallery photos={listing.photos} title={listing.title} />
        </div>

        {/* Right: purchase panel */}
        <div className="rounded-lg border border-stone-200/60 shadow-sm min-w-0 overflow-x-hidden bg-[#EFEAE0] p-6 space-y-4">
          <h1 className="text-2xl font-bold text-neutral-900 leading-snug">{listing.title}</h1>

          {/* Private listing banners */}
          {reservedForMe && (
            <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
              This piece was made just for you!
            </div>
          )}
          {reservedForOther && (
            <div className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              This is a custom piece reserved for another buyer.
            </div>
          )}

          {/* Price + Variants + Buy Buttons */}
          <ListingPurchasePanel
            basePriceCents={listing.priceCents}
            variantGroups={listing.variantGroups.map((g) => ({
              id: g.id,
              name: g.name,
              options: g.options.map((o) => ({
                id: o.id,
                label: o.label,
                priceAdjustCents: o.priceAdjustCents,
                inStock: o.inStock,
              })),
            }))}
            listingId={listingId}
            listingTitle={listing.title}
            listingImageUrl={listing.photos[0]?.url}
            currency={listing.currency}
            sellerId={listing.sellerId}
            sellerName={sellerName}
            userId={userId}
            canBuy={canBuy}
            sellerAcceptingNewOrders={listing.seller.acceptingNewOrders !== false}
            isActive={isActive}
            isOwnListing={isOwnListing}
            isOutOfStock={canSubscribeForStockNotification}
            isNotified={isNotified}
            listingType={listing.listingType}
            stockQuantity={listing.stockQuantity}
            processingLabel={processingLabel}
            offersGiftWrapping={listing.seller.offersGiftWrapping}
            giftWrappingPriceCents={listing.seller.giftWrappingPriceCents}
            ratingDisplay={stars ? stars.display.toFixed(1) : null}
            ratingCount={countReviews}
          />

          {/* Custom order */}
          {!isOwnListing && !reservedForOther && listing.seller.acceptsCustomOrders && (
            <div className="border-t border-stone-200/60 pt-4 space-y-2">
              <div className="text-sm font-medium">Want something custom?</div>
              <p className="text-xs text-neutral-500">
                Want this in a different size, wood, or finish? Ask the maker. Or{" "}
                <Link href="/commission" className="underline hover:text-neutral-700">
                  post a request in the Commission Room
                </Link>{" "}
                to reach all makers at once.
              </p>
              {meId ? (
                <CustomOrderRequestForm
                  sellerUserId={sellerUserId!}
                  sellerName={sellerName}
                  listingId={listingId}
                  listingTitle={listing.title}
                  triggerLabel="Request Something Similar"
                  triggerClassName="inline-flex items-center gap-2 rounded-md bg-[#F7F5F0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-white transition-colors"
                />
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(publicListingPath(listing.id, listing.title))}`}
                  className="inline-flex items-center gap-2 rounded-md bg-[#F7F5F0] px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-white transition-colors"
                >
                  <Wrench size={15} />
                  Request Something Similar
                </Link>
              )}
            </div>
          )}

          {/* Seller profile card */}
          <div className="border-t border-stone-200/60 pt-4 space-y-3">
            <div className="flex items-center gap-3">
              <Link href={sellerHref} className="shrink-0">
                {sellerAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={sellerAvatar}
                    alt={sellerName}
                    width={56}
                    height={56}
                    className="h-14 w-14 rounded-full object-cover ring-1 ring-neutral-200 shadow-sm"
                  />
                ) : (
                  <div className="h-14 w-14 rounded-full bg-neutral-200 flex items-center justify-center">
                    <span className="text-sm font-medium text-neutral-700">{initials}</span>
                  </div>
                )}
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={sellerHref} className="font-semibold text-sm hover:underline">
                    {sellerName}
                  </Link>
                  <GuildBadge level={listing.seller.guildLevel} showLabel={true} size={32} />
                  {listing.seller.isFoundingMaker && (
                    <FoundingMakerBadge
                      number={listing.seller.foundingMakerNumber}
                      size={22}
                    />
                  )}
                </div>
                {listing.seller.tagline && (
                  <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{listing.seller.tagline}</p>
                )}
                {sellerStars && sellerReviewCount > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <StarDisplay value={sellerStars.quarter} />
                    <span className="text-xs text-neutral-600">
                      {sellerStars.display.toFixed(1)} ({sellerReviewCount})
                    </span>
                  </div>
                )}
                {cityState && (
                  <p className="text-xs text-neutral-500 mt-0.5 flex items-center gap-1">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {cityState}
                  </p>
                )}
              </div>
            </div>

            {listing.seller.acceptingNewOrders === false && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5">
                Maker currently not accepting new orders
              </p>
            )}

            {listing.seller.vacationMode && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 px-3 py-1.5">
                This maker is currently on vacation
              </p>
            )}

            <div className="flex items-center gap-2 flex-wrap">
              {!isOwnListing && sellerUserId && (
                <FollowButton
                  sellerProfileId={listing.sellerId}
                  initialFollowing={isFollowingSeller}
                  initialCount={sellerFollowerCount}
                  size="sm"
                />
              )}
              {sellerUserId && !hideMessage && (
                <Link
                  href={signedInMessageHref}
                  className="inline-flex items-center rounded-md bg-[#F7F5F0] px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-white transition-colors"
                >
                  Message maker
                </Link>
              )}
              <Link
                href={sellerHref}
                className="inline-flex items-center rounded-md bg-[#F7F5F0] px-3 py-1.5 text-xs font-medium text-neutral-800 hover:bg-white transition-colors"
              >
                Visit Shop
              </Link>
              {meId && !isOwnListing && sellerUserId && (
                <BlockReportButton
                  targetUserId={sellerUserId}
                  targetName={listing.seller.displayName ?? "this maker"}
                  targetType="LISTING"
                  targetId={listing.id}
                  afterBlockHref="/browse"
                />
              )}
            </div>
          </div>

          {/* Tags */}
          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {listing.tags.map((t) => (
                <Link
                  key={t}
                  href={publicTagPath(t.toLowerCase())}
                  className="rounded-full border border-neutral-200 bg-[#F7F5F0] px-3 py-1 text-[11px] text-neutral-600 hover:bg-white transition-colors"
                >
                  #{t}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── About this piece ──────────────────────────────────────────────── */}
      {listing.description && (
        <section className="mb-10 max-w-2xl">
          <h2 className="font-semibold font-display text-neutral-900 mb-3">About this piece</h2>
          <DescriptionExpander text={listing.description} />
        </section>
      )}

      {/* ── Details ──────────────────────────────────────────────────────── */}
      {(listing.category || cityState || processingLabel || listing.listingType) && (
        <section className="mb-10 max-w-2xl">
          <h2 className="font-semibold font-display text-neutral-900 mb-3">Details</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
            {listing.category && (
              <>
                <dt className="text-neutral-500 font-medium">Category</dt>
                <dd>
                  <Link
                    href={`/browse?category=${categoryParam ?? listing.category}`}
                    className="text-neutral-800 hover:underline"
                  >
                    {CATEGORY_LABELS[listing.category] ?? listing.category}
                  </Link>
                </dd>
              </>
            )}
            <dt className="text-neutral-500 font-medium">Type</dt>
            <dd className="text-neutral-800">
              {listing.listingType === "IN_STOCK" ? "In stock" : "Made to order"}
            </dd>
            {processingLabel && (
              <>
                <dt className="text-neutral-500 font-medium">Processing</dt>
                <dd className="text-neutral-800">{processingLabel}</dd>
              </>
            )}
            {listing.materials && listing.materials.length > 0 && (
              <>
                <dt className="text-neutral-500 font-medium">Materials</dt>
                <dd className="text-neutral-800">{listing.materials.join(", ")}</dd>
              </>
            )}
            {(listing.productLengthIn || listing.productWidthIn || listing.productHeightIn) && (
              <>
                <dt className="text-neutral-500 font-medium">Dimensions</dt>
                <dd className="text-neutral-800">
                  {[
                    listing.productLengthIn && `${listing.productLengthIn}" L`,
                    listing.productWidthIn && `${listing.productWidthIn}" W`,
                    listing.productHeightIn && `${listing.productHeightIn}" H`,
                  ].filter(Boolean).join(" × ")}
                </dd>
              </>
            )}
            {cityState && (
              <>
                <dt className="text-neutral-500 font-medium">Ships from</dt>
                <dd className="text-neutral-800">{cityState}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      {/* ── Pickup area map ───────────────────────────────────────────────── */}
      {showPickupMap && (
        <section className="mb-10 max-w-2xl">
          <div style={{ position: "relative", zIndex: 0 }}>
            <DynamicMapCard
              lat={lat}
              lng={lng}
              radiusMeters={radius}
              label={cityState || sellerName}
              seed={listing.seller.id}
            />
          </div>
        </section>
      )}

      {/* ── More in this city ─────────────────────────────────────────────── */}
      {(listing.cityMetro ?? listing.metro) && (() => {
        const m = listing.cityMetro ?? listing.metro!;
        return (
          <div className="mb-8">
            <Link
              href={`/browse/${m.slug}`}
              className="text-sm text-neutral-600 hover:underline"
            >
              More handmade pieces in {m.name}, {m.state} →
            </Link>
          </div>
        );
      })()}

      {/* ── Shop Policies ──────────────────────────────────────────────────── */}
      {(listing.seller.returnPolicy || listing.seller.shippingPolicy || listing.seller.customOrderPolicy) && (
        <section className="card-section bg-white mb-10 max-w-2xl">
          <h2 className="text-lg font-display font-semibold px-5 py-3 border-b border-neutral-100">Shop Policies</h2>
          {listing.seller.returnPolicy && (
            <details className="border-b border-neutral-100 last:border-b-0">
              <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">
                Return Policy
              </summary>
              <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{listing.seller.returnPolicy}</p>
            </details>
          )}
          {listing.seller.shippingPolicy && (
            <details className="border-b border-neutral-100 last:border-b-0">
              <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">
                Shipping Policy
              </summary>
              <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{listing.seller.shippingPolicy}</p>
            </details>
          )}
          {listing.seller.customOrderPolicy && (
            <details className="border-b border-neutral-100 last:border-b-0">
              <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">
                Custom Order Policy
              </summary>
              <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{listing.seller.customOrderPolicy}</p>
            </details>
          )}
        </section>
      )}

      {/* ── More from this maker ────────────────────────────────────────── */}
      {moreFromSeller.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xl font-semibold font-display mb-4">
            More from {sellerName}
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {moreFromSeller.map((ml) => (
              <div key={ml.id} className="relative group">
                {/* Sibling of the Link (not nested) — same pattern as browse cards */}
                <FavoriteButton listingId={ml.id} initialSaved={moreFromSavedIds.has(ml.id)} />
                <Link href={publicListingPath(ml.id, ml.title)} className="block">
                  <div className="rounded-2xl overflow-hidden aspect-[4/5] bg-neutral-100">
                    {ml.photos[0]?.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ml.photos[0].url} alt={ml.title} loading="lazy"
                        width={320}
                        height={400}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <div className="w-full h-full bg-neutral-200" />
                    )}
                  </div>
                  <p className="mt-2 text-sm font-medium text-neutral-900 line-clamp-1">{ml.title}</p>
                  <p className="text-sm text-neutral-500">
                    {formatCurrencyCents(ml.priceCents, ml.currency)}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Similar items ─────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="font-semibold font-display text-neutral-900 mb-4">You might also like</h2>
        <SimilarItems listingId={listingId} />
      </section>

      {/* ── Similar makers — scoped to the LISTING's maker city/metro ─────── */}
      <SimilarMakers
        sellerId={listing.seller.id}
        metroId={listing.metroId}
        cityMetroId={listing.cityMetroId}
        metroName={listing.cityMetro?.name ?? listing.metro?.name ?? null}
        city={listing.seller.city}
        state={listing.seller.state}
        blockedUserIds={blockedUserIds.size > 0 ? [...blockedUserIds] : undefined}
      />

      {/* ── Reviews ───────────────────────────────────────────────────────── */}
      <section id="reviews">
        <ReviewsSection
          listingId={listingId}
          listingTitle={listing.title}
          meId={meId}
          sellerUserId={canReplyClerkId}
          initialSort={sortKey}
          edit={editingMine}
          blockedUserIds={blockedUserIds.size > 0 ? [...blockedUserIds] : undefined}
        />
      </section>
    </main>
    </div>
  );
}
