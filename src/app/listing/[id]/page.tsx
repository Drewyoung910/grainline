// src/app/listing/[id]/page.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import FavoriteButton from "@/components/FavoriteButton";
import MapCard from "@/components/MapCard";
import type { Metadata } from "next";
import ReviewsSection from "@/components/ReviewsSection";
import BuyNowButton from "@/components/BuyNowButton";
import AddToCartButton from "@/components/AddToCartButton";
import ListingViewTracker from "@/components/ListingViewTracker";
import RecentlyViewedTracker from "@/components/RecentlyViewedTracker";
import { CATEGORY_LABELS } from "@/lib/categories";
import NotifyMeButton from "@/components/NotifyMeButton";
import CustomOrderRequestForm from "@/components/CustomOrderRequestForm";
import SimilarItems from "@/components/SimilarItems";
import GuildBadge from "@/components/GuildBadge";
import FollowButton from "@/components/FollowButton";
import ListingGallery from "@/components/ListingGallery";
import DescriptionExpander from "@/components/DescriptionExpander";

function siteUrl(path: string) {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return new URL(path, base).toString();
}

export async function generateMetadata(
  { params }: { params: Promise<{ id: string }> }
): Promise<Metadata> {
  const { id } = await params;
  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      title: true,
      description: true,
      priceCents: true,
      currency: true,
      photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      seller: { select: { displayName: true, chargesEnabled: true } },
    },
  });
  if (!listing) return {};
  if (!listing.seller.chargesEnabled) {
    return {
      title: listing.title,
      robots: { index: false, follow: false },
    };
  }
  const sellerName = listing.seller.displayName ?? "Maker";
  const title = `${listing.title} by ${sellerName}`;
  const desc = (listing.description ?? "").slice(0, 160);
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
      url: siteUrl(`/listing/${id}`),
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
    alternates: { canonical: `https://grainline.co/listing/${id}` },
  };
}

function quarterRoundStars(n: number) {
  const q = Math.min(5, Math.max(0, Math.round(n * 4) / 4));
  const display = Math.round(n * 10) / 10;
  return { quarter: q, display };
}

function StarDisplay({ value, count }: { value: number; count: number }) {
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
  searchParams: Promise<{ rsort?: string; redit?: string }>;
}) {
  const { id } = await params;

  const sp = await searchParams;
  const sortKey = (sp.rsort as "top" | "new" | "rating" | "photos") ?? "top";
  const editingMine = sp.redit === "1";

  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId } });
    meId = me?.id ?? null;
  }

  const listing = await prisma.listing.findUnique({
    where: { id },
    include: {
      photos: { orderBy: { sortOrder: "asc" } },
      seller: { include: { user: true } },
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
    },
  });
  if (!listing) return notFound();

  // Non-connected seller listings are private — only the seller can view them
  if (!listing.seller.chargesEnabled) {
    const isSeller = userId && listing.seller.user?.clerkId === userId;
    if (!isSeller) {
      return notFound();
    }
  }

  const [ratingAgg, sellerRatingAgg] = await Promise.all([
    prisma.review.aggregate({
      where: { listingId: id },
      _avg: { ratingX2: true },
      _count: { _all: true },
    }),
    prisma.review.aggregate({
      where: { listing: { sellerId: listing.sellerId } },
      _avg: { ratingX2: true },
      _count: { _all: true },
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
      where: { userId: meId, listingId: id },
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
      where: { listingId_userId: { listingId: id, userId: meId } },
      select: { id: true },
    }));
  }

  const sellerName =
    listing.seller.displayName ?? listing.seller.user?.email ?? "Seller";
  const sellerHref = `/seller/${listing.sellerId}`;
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
      ? `/messages/new?to=${encodeURIComponent(sellerUserId)}&listing=${encodeURIComponent(id)}`
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
    url: siteUrl(`/listing/${listing.id}`),
    offers: {
      "@type": "Offer",
      priceCurrency: (listing.currency || "usd").toUpperCase(),
      price: (listing.priceCents / 100).toFixed(2),
      availability: "https://schema.org/InStock",
      url: siteUrl(`/listing/${listing.id}`),
      seller: { "@type": "Person", name: sellerName },
    },
  };
  if (avgStarsRaw != null && countReviews > 0) {
    productLd.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: (Math.round(avgStarsRaw * 10) / 10).toFixed(1),
      reviewCount: countReviews,
    };
  }

  const breadcrumbItems: { "@type": string; position: number; name: string; item: string }[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: "https://grainline.co" },
  ];
  if (listing.category) {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: CATEGORY_LABELS[listing.category] ?? listing.category,
      item: `https://grainline.co/browse?category=${listing.category}`,
    });
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 3,
      name: listing.title,
      item: `https://grainline.co/listing/${id}`,
    });
  } else {
    breadcrumbItems.push({
      "@type": "ListItem",
      position: 2,
      name: listing.title,
      item: `https://grainline.co/listing/${id}`,
    });
  }
  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: breadcrumbItems,
  };

  return (
    <div className="bg-gradient-to-b from-amber-100/60 via-amber-50/30 to-white min-h-screen">
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-6">
      <ListingViewTracker listingId={id} />
      <RecentlyViewedTracker listingId={id} />
      {/* JSON-LD */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productLd) }}
      />
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }}
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
            <FavoriteButton listingId={id} initialSaved={isFavorited} size={24} />
          </div>
          <ListingGallery photos={listing.photos} title={listing.title} />
        </div>

        {/* Right: purchase panel */}
        <div className="card-section bg-white p-6 space-y-4">
          <h1 className="text-2xl font-bold text-neutral-900 leading-snug">{listing.title}</h1>

          {/* Private listing banners */}
          {reservedForMe && (
            <div className="border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
              🎨 This piece was made just for you!
            </div>
          )}
          {reservedForOther && (
            <div className="border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              This is a custom piece reserved for another buyer.
            </div>
          )}

          {/* Price */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-3xl font-semibold">${(listing.priceCents / 100).toFixed(2)}</div>
            {stars && (
              <a
                href="#reviews"
                className="flex items-center gap-1.5 group"
                aria-label={`${stars.display.toFixed(1)} out of 5, ${countReviews} reviews`}
              >
                <StarDisplay value={stars.quarter} count={countReviews} />
                <span className="text-sm text-neutral-700 group-hover:underline">
                  {stars.display.toFixed(1)}{" "}
                  <span className="text-neutral-400">({countReviews})</span>
                </span>
              </a>
            )}
          </div>

          {/* Stock status */}
          {listing.listingType === "IN_STOCK" ? (
            isOutOfStock ? (
              <div className="inline-flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-full px-3 py-1 text-sm font-medium text-red-700">
                Out of Stock
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-3 py-1 text-sm font-medium text-green-700">
                In Stock · {listing.stockQuantity} available
              </div>
            )
          ) : (
            <div className="inline-flex items-center gap-1.5 bg-neutral-100 border border-neutral-200 rounded-full px-3 py-1 text-sm font-medium text-neutral-700">
              Made to order
            </div>
          )}

          {processingLabel && (
            <p className="text-sm text-neutral-600">{processingLabel}</p>
          )}

          {/* Buy buttons */}
          {isActive && !isOwnListing && isOutOfStock && (
            <NotifyMeButton
              listingId={id}
              initialSubscribed={isNotified}
              signedIn={!!userId}
            />
          )}
          {canBuy && (
            <div className="flex flex-col gap-2">
              {userId ? (
                <BuyNowButton
                  listingId={id}
                  className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] hover:bg-neutral-700 transition-colors"
                >
                  Buy now
                </BuyNowButton>
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(`/listing/${id}`)}`}
                  className="w-full rounded-md bg-neutral-900 px-4 py-3 text-white text-sm font-medium min-h-[48px] text-center flex items-center justify-center hover:bg-neutral-700 transition-colors"
                >
                  Sign in to buy
                </Link>
              )}
              <AddToCartButton
                listingId={id}
                signedIn={!!userId}
                className="w-full rounded-md border border-neutral-300 px-4 py-3 text-sm font-medium min-h-[48px] hover:bg-neutral-50 transition-colors"
              />
            </div>
          )}

          {/* Seller offers gift wrapping */}
          {listing.seller.offersGiftWrapping && canBuy && (
            <p className="text-xs text-neutral-500">
              🎁 Gift wrapping available
              {listing.seller.giftWrappingPriceCents
                ? ` · $${(listing.seller.giftWrappingPriceCents / 100).toFixed(2)}`
                : ""}
            </p>
          )}

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
                  listingId={id}
                  listingTitle={listing.title}
                  triggerLabel="🔨 Request Something Similar"
                  triggerClassName="inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                />
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(`/listing/${id}`)}`}
                  className="inline-flex items-center gap-2 border px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                >
                  🔨 Request Something Similar
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
                  <GuildBadge level={listing.seller.guildLevel} showLabel={false} size={16} />
                </div>
                {listing.seller.tagline && (
                  <p className="text-xs text-neutral-500 mt-0.5 line-clamp-1">{listing.seller.tagline}</p>
                )}
                {sellerStars && sellerReviewCount > 0 && (
                  <div className="flex items-center gap-1.5 mt-1">
                    <StarDisplay value={sellerStars.quarter} count={sellerReviewCount} />
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
            <MapCard
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

      {/* ── Similar items ─────────────────────────────────────────────────── */}
      <section className="mb-10">
        <h2 className="font-semibold font-display text-neutral-900 mb-4">You might also like</h2>
        <SimilarItems listingId={id} />
      </section>

      {/* ── Reviews ───────────────────────────────────────────────────────── */}
      <section id="reviews">
        <ReviewsSection
          listingId={id}
          meId={meId}
          sellerUserId={canReplyClerkId}
          initialSort={sortKey}
          edit={editingMine}
        />
      </section>
    </main>
    </div>
  );
}
