// src/app/listing/[id]/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
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
import GuildBadge from "@/components/GuildBadge";
import FollowButton from "@/components/FollowButton";
import { safeJsonLd } from "@/lib/json-ld";
import ListingGallery from "@/components/ListingGallery";
import DescriptionExpander from "@/components/DescriptionExpander";
import BlockReportButton from "@/components/BlockReportButton";
import { Hammer } from "@/components/icons";
import { canViewListingDetail, isPublicListing } from "@/lib/listingVisibility";
import { extractRouteId, publicListingPath, publicSellerPath } from "@/lib/publicPaths";

function siteUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(path, base).toString();
}

export async function generateMetadata(
  { params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[]>> }
): Promise<Metadata> {
  const { id } = await params;
  const listingId = extractRouteId(id);
  const sp = await searchParams;
  if (sp.preview === "1") {
    return { robots: { index: false, follow: false } };
  }
  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    select: {
      title: true,
      description: true,
      metaDescription: true,
      priceCents: true,
      currency: true,
      status: true,
      isPrivate: true,
      photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      seller: {
        select: {
          displayName: true,
          chargesEnabled: true,
          vacationMode: true,
          user: { select: { banned: true, deletedAt: true } },
        },
      },
    },
  });
  if (!listing) return {};
  if (!isPublicListing(listing)) {
    return {
      title: listing.title,
      robots: { index: false, follow: false },
    };
  }
  const sellerName = listing.seller.displayName ?? "Maker";
  const title = `${listing.title} by ${sellerName}`;
  const desc = listing.metaDescription || (listing.description ?? "").slice(0, 160);
  const img = listing.photos[0]?.url;
  const price = (listing.priceCents / 100).toFixed(2);
  const currency = (listing.currency || "usd").toUpperCase();

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
    <div className="relative leading-none inline-block" aria-hidden>
      <div className="text-neutral-300">★★★★★</div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ width: `${(q / 5) * 100}%` }}
      >
        <div className="text-amber-500">★★★★★</div>
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

  const sp = await searchParams;
  const sortKey = (sp.rsort as "top" | "new" | "rating" | "photos") ?? "top";
  const editingMine = sp.redit === "1";

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    meId = me?.id ?? null;
  }
  const blockedUserIds = await getBlockedUserIdsFor(meId);

  const listing = await prisma.listing.findUnique({
    where: { id: listingId },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      seller: { include: { user: { select: { id: true, clerkId: true, email: true, imageUrl: true, banned: true, deletedAt: true } } } },
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
      variantGroups: {
        orderBy: { sortOrder: "asc" },
        include: { options: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  if (!listing) return notFound();

  // Preview mode: seller can view their own listing regardless of status/chargesEnabled
  const isPreview = sp.preview === "1" && !!userId && listing.seller.user?.clerkId === userId;

  if (!canViewListingDetail(listing, { dbUserId: meId, clerkUserId: userId, preview: isPreview })) {
    return notFound();
  }

  // Block filter — return 404 if the viewer has blocked or been blocked by the seller
  if (!isPreview && listing.seller.user?.id && blockedUserIds.has(listing.seller.user.id)) {
    return notFound();
  }

  const [ratingAgg, sellerRatingAgg, moreFromSeller, topReviews] = await Promise.all([
    prisma.review.aggregate({
      where: { listingId },
      _avg: { ratingX2: true },
      _count: { _all: true },
    }),
    prisma.review.aggregate({
      where: { listing: { sellerId: listing.sellerId } },
      _avg: { ratingX2: true },
      _count: { _all: true },
    }),
    prisma.listing.findMany({
      where: {
        sellerId: listing.sellerId,
        status: "ACTIVE",
        isPrivate: false,
        id: { not: listing.id },
      },
      orderBy: { qualityScore: "desc" },
      take: 4,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    }),
    prisma.review.findMany({
      where: { listingId },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true,
        ratingX2: true,
        comment: true,
        createdAt: true,
        reviewer: { select: { name: true } },
      },
    }),
  ]);

  const avgStarsRaw = ratingAgg._avg.ratingX2 ? ratingAgg._avg.ratingX2 / 2 : null;
  const countReviews = ratingAgg._count._all || 0;
  const stars = avgStarsRaw != null ? quarterRoundStars(avgStarsRaw) : null;

  const sellerAvgRaw = sellerRatingAgg._avg.ratingX2
    ? sellerRatingAgg._avg.ratingX2 / 2
    : null;
  const sellerReviewCount = sellerRatingAgg._count._all || 0;
  const sellerStars = sellerAvgRaw != null ? quarterRoundStars(sellerAvgRaw) : null;

  let isFavorited = false;
  if (meId) {
    isFavorited = !!(await prisma.favorite.findFirst({
      where: { userId: meId, listingId },
      select: { userId: true },
    }));
  }

  const isOutOfStock =
    listing.status === "SOLD_OUT" ||
    (listing.listingType === "IN_STOCK" && (listing.stockQuantity ?? 0) <= 0);

  const [sellerFollowerCount, isFollowingSeller] = await Promise.all([
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
  ]);

  let isNotified = false;
  if (meId && isOutOfStock) {
    isNotified = !!(await prisma.stockNotification.findUnique({
      where: { listingId_userId: { listingId, userId: meId } },
      select: { id: true },
    }));
  }

  const sellerName =
    listing.seller.displayName ?? listing.seller.user?.email ?? "Maker";
  const sellerHref = publicSellerPath(listing.sellerId, sellerName);
  const sellerAvatar = listing.seller.avatarImageUrl ?? listing.seller.user?.imageUrl ?? null;

  const sellerDbUserId = listing.seller.user?.id ?? null;
  const sellerClerkId = listing.seller.user?.clerkId ?? null;
  const sellerUserId = sellerDbUserId;

  const initials =
    (sellerName || "S")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "S";

  const lat = listing.seller.lat != null ? Number(listing.seller.lat) : null;
  const lng = listing.seller.lng != null ? Number(listing.seller.lng) : null;
  const radius = Number(listing.seller.radiusMeters ?? 0);
  const cityState = [listing.seller.city, listing.seller.state].filter(Boolean).join(", ");

  const signedInMessageHref =
    sellerUserId
      ? `/messages/new?to=${encodeURIComponent(sellerUserId)}&listing=${encodeURIComponent(listingId)}`
      : "#";
  const hideMessage = !!meId && !!sellerUserId && meId === sellerUserId;

  const canReplyClerkId = userId && sellerClerkId === userId ? userId : null;

  const isActive = listing.status === "ACTIVE";
  const isOwnListing = !!meId && !!sellerUserId && meId === sellerUserId;

  const isPrivate = listing.isPrivate;
  const reservedForMe = isPrivate && !!meId && listing.reservedForUserId === meId;
  const reservedForOther = isPrivate && (!meId || listing.reservedForUserId !== meId);

  const canBuy = isActive && !isOwnListing && !isOutOfStock && !reservedForOther;

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
      priceCurrency: (listing.currency || "usd").toUpperCase(),
      price: (listing.priceCents / 100).toFixed(2),
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
      ...(r.comment ? { reviewBody: r.comment.slice(0, 200) } : {}),
    }));
  }

  const breadcrumbItems: { "@type": string; position: number; name: string; item: string }[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://thegrainline.com" },
  ];
  if (listing.category) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: CATEGORY_LABELS[listing.category] ?? listing.category,
      item: `https://thegrainline.com/browse?category=${listing.category}`,
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
    <div className="bg-gradient-to-b from-amber-100/60 via-amber-50/30 to-white min-h-screen">
    {isPreview && (
      <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-800 text-center">
        Preview mode — this is how your listing appears to buyers. It is not yet published.
      </div>
    )}
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 pb-16 pt-6">
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
      <div className="grid lg:grid-cols-2 gap-8 mb-10">
        {/* Left: gallery */}
        <div className="relative">
          {/* Favorite button overlaid */}
          <div className="absolute right-3 top-3 z-10">
            <FavoriteButton listingId={listingId} initialSaved={isFavorited} size={24} />
          </div>
          <ListingGallery photos={listing.photos} title={listing.title} />
        </div>

        {/* Right: purchase panel */}
        <div className="card-section bg-white p-6 space-y-4">
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
            sellerId={listing.sellerId}
            sellerName={sellerName}
            userId={userId}
            canBuy={canBuy}
            isActive={isActive}
            isOwnListing={isOwnListing}
            isOutOfStock={isOutOfStock}
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
                  triggerClassName="inline-flex items-center gap-2 border border-neutral-200 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                />
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(publicListingPath(listing.id, listing.title))}`}
                  className="inline-flex items-center gap-2 border border-neutral-200 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                >
                  <Hammer size={15} />
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
                    className="h-14 w-14 rounded-full object-cover border border-neutral-200"
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
              <Link
                href={sellerHref}
                className="text-xs rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 transition-colors"
              >
                Visit Shop
              </Link>
              {!isOwnListing && sellerUserId && (
                <FollowButton
                  sellerProfileId={listing.sellerId}
                  sellerUserId={sellerUserId}
                  initialFollowing={isFollowingSeller}
                  initialCount={sellerFollowerCount}
                  size="sm"
                />
              )}
              {sellerUserId && !hideMessage && (
                <Link
                  href={signedInMessageHref}
                  className="text-xs rounded-md border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50 transition-colors"
                >
                  Message maker
                </Link>
              )}
              {meId && !isOwnListing && sellerUserId && (
                <BlockReportButton
                  targetUserId={sellerUserId}
                  targetName={listing.seller.displayName ?? "this maker"}
                  targetType="LISTING"
                  targetId={listing.id}
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
                  href={`/browse?tag=${encodeURIComponent(t.toLowerCase())}`}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-600 hover:bg-neutral-100 transition-colors"
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
                    href={`/browse?category=${listing.category}`}
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
      {lat != null && lng != null && (
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
        <section className="card-section p-6 mb-10">
          <h2 className="font-semibold font-display text-neutral-900 mb-3">Shop Policies</h2>
          <div className="space-y-0">
            {listing.seller.returnPolicy && (
              <details className="border-b border-neutral-100 last:border-0">
                <summary className="py-3 text-sm font-medium text-neutral-800 cursor-pointer list-none flex items-center justify-between">
                  Returns & Exchanges
                  <span className="text-neutral-400 text-xs">▾</span>
                </summary>
                <p className="pb-3 text-sm text-neutral-600 leading-relaxed">{listing.seller.returnPolicy}</p>
              </details>
            )}
            {listing.seller.shippingPolicy && (
              <details className="border-b border-neutral-100 last:border-0">
                <summary className="py-3 text-sm font-medium text-neutral-800 cursor-pointer list-none flex items-center justify-between">
                  Shipping
                  <span className="text-neutral-400 text-xs">▾</span>
                </summary>
                <p className="pb-3 text-sm text-neutral-600 leading-relaxed">{listing.seller.shippingPolicy}</p>
              </details>
            )}
            {listing.seller.customOrderPolicy && (
              <details className="border-b border-neutral-100 last:border-0">
                <summary className="py-3 text-sm font-medium text-neutral-800 cursor-pointer list-none flex items-center justify-between">
                  Custom Orders
                  <span className="text-neutral-400 text-xs">▾</span>
                </summary>
                <p className="pb-3 text-sm text-neutral-600 leading-relaxed">{listing.seller.customOrderPolicy}</p>
              </details>
            )}
          </div>
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
              <Link key={ml.id} href={publicListingPath(ml.id, ml.title)} className="group">
                <div className="rounded-2xl overflow-hidden aspect-square bg-neutral-100">
                  {ml.photos[0]?.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ml.photos[0].url} alt={ml.title} loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  ) : (
                    <div className="w-full h-full bg-neutral-200" />
                  )}
                </div>
                <p className="mt-2 text-sm font-medium text-neutral-900 line-clamp-1">{ml.title}</p>
                <p className="text-sm text-neutral-500">
                  ${(ml.priceCents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}
                </p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ── Similar items ─────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="font-semibold font-display text-neutral-900 mb-4">You might also like</h2>
        <SimilarItems listingId={listingId} />
      </section>

      {/* ── Reviews ───────────────────────────────────────────────────────── */}
      <section id="reviews">
        <ReviewsSection
          listingId={listingId}
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
