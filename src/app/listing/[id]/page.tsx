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
      seller: { select: { displayName: true } },
    },
  });
  if (!listing) return {};
  const title = listing.title;
  const desc = (listing.description ?? "").slice(0, 160);
  const img = listing.photos[0]?.url;
  const price = (listing.priceCents / 100).toFixed(2);
  const currency = (listing.currency || "usd").toUpperCase();

  return {
    title,
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
    },
  });
  if (!listing) return notFound();

  const ratingAgg = await prisma.review.aggregate({
    where: { listingId: id },
    _avg: { ratingX2: true },
    _count: { _all: true },
  });
  const avgStarsRaw = ratingAgg._avg.ratingX2 ? ratingAgg._avg.ratingX2 / 2 : null;
  const countReviews = ratingAgg._count._all || 0;
  const stars = avgStarsRaw != null ? quarterRoundStars(avgStarsRaw) : null;

  const hero = listing.photos[0]?.url ?? "/favicon.ico";

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

  // ⬇️ BUY/ADD VISIBILITY
  const isActive = listing.status === "ACTIVE";
  const isOwnListing = !!meId && !!sellerUserId && meId === sellerUserId;

  // Private / reserved listing logic
  const isPrivate = listing.isPrivate;
  const reservedForMe = isPrivate && !!meId && listing.reservedForUserId === meId;
  const reservedForOther = isPrivate && (!meId || listing.reservedForUserId !== meId);

  const canBuy = isActive && !isOwnListing && !isOutOfStock && !reservedForOther;

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
    <main className="p-8 max-w-4xl mx-auto space-y-6">
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

      <Link href="/browse" className="text-sm underline">
        &larr; Back to Browse
      </Link>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="relative w-full aspect-square overflow-hidden rounded-xl border">
          <div className="absolute right-3 top-3 z-10">
            <FavoriteButton
              listingId={id}
              initialSaved={isFavorited}
              size={24}
            />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={hero} alt={listing.title} className="w-full h-full object-cover" />
        </div>

        <div className="space-y-4">
          <h1 className="text-2xl font-semibold">{listing.title}</h1>

          {/* Private listing banners */}
          {reservedForMe && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 font-medium">
              🎨 This piece was made just for you!
            </div>
          )}
          {reservedForOther && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-600">
              This is a custom piece reserved for another buyer.
            </div>
          )}

          {/* Listing type / availability */}
          {listing.listingType === "IN_STOCK" ? (
            isOutOfStock ? (
              <div className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                Out of Stock
              </div>
            ) : (
              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-3 py-1 text-sm font-medium text-green-700">
                  In Stock ({listing.stockQuantity} available)
                </div>
                {listing.shipsWithinDays != null && (
                  <div className="text-sm text-neutral-600">
                    Ships within{" "}
                    <span className="font-medium">{listing.shipsWithinDays} day{listing.shipsWithinDays !== 1 ? "s" : ""}</span>
                  </div>
                )}
              </div>
            )
          ) : listing.processingTimeMinDays != null || listing.processingTimeMaxDays != null ? (
            <div className="text-sm text-neutral-600">
              Made to order — ships in{" "}
              <span className="font-medium">
                {listing.processingTimeMinDays ?? 1}–{listing.processingTimeMaxDays ?? 7} days
              </span>
            </div>
          ) : (
            <div className="text-sm text-neutral-600">Made to order</div>
          )}

          {/* Price + rating */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-2xl font-semibold">${(listing.priceCents / 100).toFixed(2)}</div>

            {stars && (
              <a
                href="#reviews"
                className="flex items-center gap-2 group"
                aria-label={`Jump to reviews (${stars.display.toFixed(1)} out of 5, ${countReviews} reviews)`}
              >
                <div className="relative leading-none" aria-hidden>
                  <div className="text-neutral-300">★★★★★</div>
                  <div
                    className="absolute inset-0 overflow-hidden"
                    style={{ width: `${(stars.quarter / 5) * 100}%` }}
                  >
                    <div className="text-amber-500">★★★★★</div>
                  </div>
                </div>
                <div className="text-sm text-neutral-700 group-hover:underline underline-offset-2">
                  {stars.display.toFixed(1)}{" "}
                  <span className="text-neutral-400">({countReviews})</span>
                </div>
              </a>
            )}
          </div>

          {/* ⬇️ Add to cart + Buy now — full width on mobile */}
          {isActive && !isOwnListing && isOutOfStock && (
            <div>
              <span className="rounded border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-700">
                Out of stock
              </span>
            </div>
          )}
          {canBuy && (
            <div className="flex flex-col sm:flex-row gap-2">
              <AddToCartButton
                listingId={id}
                signedIn={!!userId}
                className="w-full sm:w-auto rounded border px-4 py-3 sm:py-1.5 text-sm min-h-[44px]"
              />
              {userId ? (
                <BuyNowButton
                  listingId={id}
                  className="w-full sm:w-auto rounded bg-neutral-900 px-4 py-3 sm:py-1.5 text-white text-sm min-h-[44px]"
                >
                  Buy now
                </BuyNowButton>
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(`/listing/${id}`)}`}
                  className="w-full sm:w-auto rounded bg-neutral-900 px-4 py-3 sm:py-1.5 text-white text-sm text-center min-h-[44px] flex items-center justify-center"
                >
                  Sign in to buy
                </Link>
              )}
            </div>
          )}

          {/* Custom order request — below buy buttons */}
          {!isOwnListing && !reservedForOther && listing.seller.acceptsCustomOrders && (
            <div className="rounded-xl border bg-neutral-50 p-4 space-y-2">
              <div className="text-sm font-medium">Want something custom?</div>
              <p className="text-xs text-neutral-500">
                Want this in a different size, wood, or finish? Ask the maker.
              </p>
              {meId ? (
                <CustomOrderRequestForm
                  sellerUserId={sellerUserId!}
                  sellerName={sellerName}
                  listingId={id}
                  listingTitle={listing.title}
                  triggerLabel="🔨 Request Something Similar"
                  triggerClassName="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                />
              ) : (
                <Link
                  href={`/sign-in?redirect_url=${encodeURIComponent(`/listing/${id}`)}`}
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
                >
                  🔨 Request Something Similar
                </Link>
              )}
            </div>
          )}

          {isOutOfStock && !isOwnListing && (
            <NotifyMeButton
              listingId={id}
              initialSubscribed={isNotified}
              signedIn={!!userId}
            />
          )}

          <p className="text-sm opacity-80">{listing.description}</p>

          {listing.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {listing.tags.map((t) => (
                <Link
                  key={t}
                  href={`/browse?tag=${encodeURIComponent(t.toLowerCase())}`}
                  className="rounded-full border px-2 py-0.5 text-[11px] hover:bg-neutral-50"
                >
                  #{t}
                </Link>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <Link
                href={sellerHref}
                className="inline-flex items-center gap-2 text-xs rounded-full border px-3 py-1 hover:bg-neutral-50"
              >
                {sellerAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sellerAvatar} alt={sellerName} className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <div className="h-5 w-5 rounded-full bg-neutral-200 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-neutral-700">{initials}</span>
                  </div>
                )}
                <span>{sellerName}</span>
              </Link>

              <GuildBadge level={listing.seller.guildLevel} showLabel={true} size={18} />

              {sellerUserId && !hideMessage && (
                <Link
                  href={signedInMessageHref}
                  className="text-xs rounded-full border px-3 py-1 hover:bg-neutral-50"
                >
                  Message maker
                </Link>
              )}
            </div>

            {listing.seller.acceptingNewOrders === false && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-3 py-1 w-fit">
                Maker currently not accepting new orders
              </p>
            )}
          </div>

          {lat != null && lng != null && (
            <div className="pt-2">
              <MapCard
                lat={lat}
                lng={lng}
                radiusMeters={radius}
                label={cityState || sellerName}
                seed={listing.seller.id}
              />
            </div>
          )}
        </div>
      </div>

      {listing.photos.length > 1 && (
        /* Mobile: horizontal scroll; desktop: grid */
        <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 sm:grid sm:grid-cols-4 sm:overflow-visible sm:pb-0">
          {listing.photos.slice(1).map((p) => (
            <div key={p.id} className="relative w-32 h-32 sm:w-auto sm:h-auto sm:aspect-square shrink-0 sm:shrink overflow-hidden rounded-lg border snap-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      )}

      <SimilarItems listingId={id} />

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
  );
}
















