// src/app/seller/[id]/page.tsx
import { notFound, permanentRedirect } from "next/navigation";
import Link from "next/link";
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
import SellerProfileViewTracker from "@/components/SellerProfileViewTracker";
import ListingCard from "@/components/ListingCard";
import LocalDate from "@/components/LocalDate";
import MediaImage from "@/components/MediaImage";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { publicListingWhere } from "@/lib/listingVisibility";
import { extractRouteId, publicSellerPath, publicSellerShopPath, routeSegmentWithSlug } from "@/lib/publicPaths";
import { truncateText } from "@/lib/sanitize";
import { getSellerRatingMap } from "@/lib/sellerRatingSummary";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sellerId = extractRouteId(id);
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      displayName: true,
      bio: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      chargesEnabled: true,
      user: { select: { imageUrl: true, banned: true, deletedAt: true } },
    },
  });
  if (!seller) return {};
  if (!seller.chargesEnabled || seller.user?.banned || seller.user?.deletedAt) {
    return { robots: { index: false, follow: false } };
  }

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

export default async function SellerPublicPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const sellerId = extractRouteId(id);

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    include: {
      user: { select: { id: true, clerkId: true, name: true, imageUrl: true, banned: true, deletedAt: true } },
      faqs: { orderBy: { sortOrder: "asc" } },
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
    },
  });

  if (!seller) return notFound();
  if (seller.user?.banned || seller.user?.deletedAt) return notFound();

  // Current viewer
  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }
  const isOwner = !!userId && seller.user?.clerkId === userId;
  if (!isOwner && !seller.chargesEnabled) return notFound();

  // Block check — return 404 if the viewer has blocked or been blocked by the seller
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (seller.user?.id && blockedUserIds.has(seller.user.id)) {
    return notFound();
  }

  if (id !== routeSegmentWithSlug(seller.id, seller.displayName, "maker")) {
    permanentRedirect(publicSellerPath(seller.id, seller.displayName));
  }

  // Follow data
  const [followerCount, isFollowing] = await Promise.all([
    prisma.follow.count({ where: { sellerProfileId: seller.id } }),
    meId
      ? prisma.follow.findUnique({
          where: { followerId_sellerProfileId: { followerId: meId, sellerProfileId: seller.id } },
          select: { id: true },
        }).then((r) => r !== null)
      : Promise.resolve(false),
  ]);

  // Ensure numbers (handle Prisma Decimal/null)
  const lat = seller.lat != null ? Number(seller.lat) : null;
  const lng = seller.lng != null ? Number(seller.lng) : null;
  const radiusMeters =
    seller.radiusMeters != null ? Number(seller.radiusMeters) : null;

  const cityState = [seller.city, seller.state].filter(Boolean).join(", ");

  // Fetch most recent broadcast (shown as "Latest Update" if < 30 days old)
  const latestBroadcast = await prisma.sellerBroadcast.findFirst({
    where: { sellerProfileId: seller.id },
    orderBy: { sentAt: "desc" },
    select: { message: true, sentAt: true, imageUrl: true },
  });
  const broadcastAgeDays = latestBroadcast
    ? (Date.now() - latestBroadcast.sentAt.getTime()) / (1000 * 60 * 60 * 24)
    : null;

  // Fetch published blog posts by this seller
  const sellerBlogPosts = await prisma.blogPost.findMany({
    where: publicBlogPostWhere({ sellerProfileId: seller.id }),
    orderBy: { publishedAt: "desc" },
    take: 3,
    select: { slug: true, title: true, excerpt: true, coverImageUrl: true, publishedAt: true, type: true },
  });

  // Fetch all listings (capped — very large shops use the /seller/[id]/shop paginated page)
  const listings = await prisma.listing.findMany({
    where: publicListingWhere({ sellerId: seller.id }),
    include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  // Fetch featured listings in order
  let featuredListings: typeof listings = [];
  if (seller.featuredListingIds && seller.featuredListingIds.length > 0) {
    const featuredById = new Map(
      listings
        .filter((l) => seller.featuredListingIds.includes(l.id))
        .map((l) => [l.id, l])
    );
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

  const sellerRatingMap = await getSellerRatingMap([seller.id]);
  const shopRating = sellerRatingMap.get(seller.id) ?? null;

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
    ...(hasStructuredAddress && lat != null && lng != null
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

  // Add social links to JSON-LD
  const sameAs: string[] = [];
  if (seller.instagramUrl) sameAs.push(seller.instagramUrl);
  if (seller.facebookUrl) sameAs.push(seller.facebookUrl);
  if (seller.pinterestUrl) sameAs.push(seller.pinterestUrl);
  if (seller.tiktokUrl) sameAs.push(seller.tiktokUrl);
  if (seller.websiteUrl) sameAs.push(seller.websiteUrl);
  if (sameAs.length > 0) businessLd.sameAs = sameAs;

  // Social links
  type SocialLink = { label: string; url: string; Icon: (p: { size?: number; className?: string }) => React.ReactElement };
  const socialLinks: SocialLink[] = (
    [
      seller.instagramUrl ? { label: "Instagram", url: seller.instagramUrl, Icon: Instagram } : null,
      seller.facebookUrl  ? { label: "Facebook",  url: seller.facebookUrl,  Icon: Facebook  } : null,
      seller.pinterestUrl ? { label: "Pinterest", url: seller.pinterestUrl, Icon: Pinterest } : null,
      seller.tiktokUrl    ? { label: "TikTok",    url: seller.tiktokUrl,    Icon: TikTok    } : null,
      seller.websiteUrl   ? { label: "Website",   url: seller.websiteUrl,   Icon: Globe     } : null,
    ] as (SocialLink | null)[]
  ).filter((x): x is SocialLink => x !== null);

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
              Expected return: <LocalDate date={seller.vacationReturnDate} />
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

      {/* ── Banner ──────────────────────────────────────────────────────────
          Outer div is NOT overflow-hidden because avatar uses translate-y-1/2
          to overlap below the banner; inner wrapper owns the rounded corners. */}
      <div className="relative aspect-[3/1] mt-4">
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

      {/* ── Identity row (post-banner) ───────────────────────────────────── */}
      <div className="px-2 sm:px-4 pt-16 pb-2">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold font-display">{seller.displayName}</h1>
              <GuildBadge level={seller.guildLevel} showLabel={true} size={32} />
              {seller.isFoundingMaker && (
                <FoundingMakerBadge number={seller.foundingMakerNumber} showLabel={true} size={26} />
              )}
            </div>
            {seller.tagline && (
              <p className="text-sm text-neutral-600 mt-1 italic">{seller.tagline}</p>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600 mt-2">
              {cityState && (
                <span className="flex items-center gap-1">
                  <MapPin size={14} className="shrink-0" />
                  {cityState}
                </span>
              )}
              {seller.yearsInBusiness != null && (
                <span>{seller.yearsInBusiness} {seller.yearsInBusiness === 1 ? "year" : "years"} in business</span>
              )}
              {shopRating && shopRating.count > 0 && (
                <span className="flex items-center gap-1">
                  <StarsInline value={shopRating.avg} />
                  <span className="font-medium text-neutral-700">{(Math.round(shopRating.avg * 10) / 10).toFixed(1)}</span>
                  <span className="text-neutral-500">({shopRating.count})</span>
                </span>
              )}
              {seller.acceptsCustomOrders && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Accepting custom orders</span>
              )}
              {!seller.acceptingNewOrders && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Not currently taking new orders</span>
              )}
            </div>
          </div>
          <Link href="/browse" className="text-sm text-neutral-600 underline shrink-0 mt-1">
            ← Back to Browse
          </Link>
        </div>

        {/* Action row: follow, message, custom order, report */}
        {meId !== seller.userId && (
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FollowButton
              sellerProfileId={seller.id}
              sellerUserId={seller.userId}
              initialFollowing={isFollowing}
              initialCount={followerCount}
              size="sm"
            />
            {seller.acceptsCustomOrders && (
              <>
                {meId ? (
                  <CustomOrderRequestForm
                    sellerUserId={seller.userId}
                    sellerName={seller.displayName}
                    triggerLabel="Request a Custom Piece"
                    triggerClassName="inline-flex items-center gap-2 rounded-md bg-[#2C1F1A] text-white px-4 py-2 text-sm font-medium hover:bg-[#3A2A24]"
                  />
                ) : (
                  <Link
                    href={`/sign-in?redirect_url=${encodeURIComponent(publicSellerPath(seller.id, seller.displayName))}`}
                    className="inline-flex items-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                  >
                    <Hammer size={15} />
                    Request a Custom Piece
                  </Link>
                )}
              </>
            )}
            {meId && (
              <BlockReportButton
                targetUserId={seller.userId}
                targetName={seller.displayName ?? "this maker"}
                targetType="SELLER"
                targetId={seller.id}
              />
            )}
          </div>
        )}

        {socialLinks.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-3">
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
      </div>

      {/* ── Latest Broadcast (full-width banner-style) ─────────────────── */}
      {latestBroadcast && broadcastAgeDays !== null && broadcastAgeDays < 30 && (
        <section className="mb-6 mt-4 mx-2 sm:mx-4 rounded-2xl bg-[#EFEAE0] p-5 sm:p-6">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
            Shop Update · <LocalDate date={latestBroadcast.sentAt} />
          </div>
          <p className="text-sm text-neutral-800 whitespace-pre-line">{latestBroadcast.message}</p>
          {latestBroadcast.imageUrl && (
            <MediaImage
              src={latestBroadcast.imageUrl}
              alt="Update"
              className="mt-3 w-full max-h-48 object-cover rounded-md"
              fallbackClassName="mt-3 h-32 w-full bg-gradient-to-br from-amber-50 to-stone-100 rounded-md"
            />
          )}
        </section>
      )}

      {/* ── Two-column body grid ───────────────────────────────────────── */}
      <div className="px-2 sm:px-4 pb-12 mt-6 grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6 lg:gap-8">

        {/* ── Sidebar ────────────────────────────────────────────────────── */}
        <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-2">
          {/* About / Story card */}
          {(seller.bio || seller.storyTitle || seller.storyBody) && (
            <section className="card-section p-5 bg-white">
              <h2 className="text-base font-display font-semibold mb-3">
                {seller.storyTitle || "About"}
              </h2>
              {seller.storyBody && (
                <p className="text-sm text-neutral-700 whitespace-pre-line mb-3 leading-relaxed">
                  {seller.storyBody}
                </p>
              )}
              {seller.bio && !seller.storyBody && (
                <p className="text-sm text-neutral-700 whitespace-pre-line leading-relaxed">{seller.bio}</p>
              )}
              {seller.bio && seller.storyBody && seller.bio !== seller.storyBody && (
                <p className="text-sm text-neutral-700 whitespace-pre-line leading-relaxed border-t border-neutral-100 pt-3">
                  {seller.bio}
                </p>
              )}
            </section>
          )}

          {/* Pickup map */}
          {lat != null && lng != null && (
            <section className="card-section p-4 bg-white space-y-3">
              <h2 className="text-base font-display font-semibold">Pickup area</h2>
              <DynamicMapCard
                lat={lat}
                lng={lng}
                label={cityState || seller.displayName || "Pickup area"}
                radiusMeters={radiusMeters ?? null}
                showPinWithRadius={false}
              />
              <p className="text-xs text-neutral-600">
                {radiusMeters
                  ? "Approximate pickup area shown for privacy."
                  : "Exact pickup point shown by seller."}
              </p>
            </section>
          )}

          {/* Shop Policies accordion */}
          {(seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy) && (
            <section className="card-section bg-white">
              <h2 className="text-base font-display font-semibold px-5 py-3 border-b border-neutral-100">Shop Policies</h2>
              {seller.returnPolicy && (
                <details className="border-b border-neutral-100 last:border-b-0">
                  <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">Return Policy</summary>
                  <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.returnPolicy}</p>
                </details>
              )}
              {seller.customOrderPolicy && (
                <details className="border-b border-neutral-100 last:border-b-0">
                  <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">Custom Order Policy</summary>
                  <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.customOrderPolicy}</p>
                </details>
              )}
              {seller.shippingPolicy && (
                <details className="border-b border-neutral-100 last:border-b-0">
                  <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">Shipping Policy</summary>
                  <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{seller.shippingPolicy}</p>
                </details>
              )}
            </section>
          )}

          {/* FAQs accordion */}
          {seller.faqs.length > 0 && (
            <section className="card-section bg-white">
              <h2 className="text-base font-display font-semibold px-5 py-3 border-b border-neutral-100">FAQs</h2>
              {seller.faqs.map((faq) => (
                <details key={faq.id} className="border-b border-neutral-100 last:border-b-0">
                  <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">{faq.question}</summary>
                  <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{faq.answer}</p>
                </details>
              ))}
            </section>
          )}

          {/* More makers in this city */}
          {(seller.cityMetro ?? seller.metro) && (() => {
            const m = seller.cityMetro ?? seller.metro!;
            return (
              <section className="card-section p-5 bg-white space-y-2">
                <h2 className="text-base font-display font-semibold mb-1">More from {m.name}</h2>
                <Link href={`/makers/${m.slug}`} className="text-sm text-amber-700 hover:underline block">
                  Other makers in {m.name}, {m.state} →
                </Link>
                <Link href={`/browse/${m.slug}`} className="text-sm text-amber-700 hover:underline block">
                  Browse {m.name}, {m.state} listings →
                </Link>
              </section>
            );
          })()}
        </aside>

        {/* ── Main column ───────────────────────────────────────────────── */}
        <div className="space-y-10 min-w-0">
          {/* Featured Work */}
          {featuredListings.length > 0 && (
            <section>
              <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Featured Work</h2>
              <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
                {featuredListings.map((l) => (
                  <ClickTracker key={l.id} listingId={l.id} className="w-[200px] flex-none snap-start md:w-auto">
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
            </section>
          )}

          {/* All Listings */}
          <section>
            {(() => {
              const activePublicCount = listings.filter((l) => l.status === "ACTIVE" && !l.isPrivate).length;
              return (
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl sm:text-2xl font-display font-semibold">All Listings</h2>
                  {activePublicCount > 0 && (
                    <Link
                      href={publicSellerShopPath(seller.id, seller.displayName)}
                      className="text-sm text-amber-700 hover:underline"
                    >
                      See all {activePublicCount} {activePublicCount === 1 ? "piece" : "pieces"} →
                    </Link>
                  )}
                </div>
              );
            })()}
            {listings.length === 0 ? (
              <div className="card-section p-6 text-neutral-600 bg-white">No listings yet.</div>
            ) : (
              <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 md:grid-cols-3 sm:gap-6">
                {listings.slice(0, 9).map((l) => (
                  <ClickTracker key={l.id} listingId={l.id} className="w-[220px] flex-none snap-start sm:w-auto">
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
            )}
            {(() => {
              const activePublicCount = listings.filter((l) => l.status === "ACTIVE" && !l.isPrivate).length;
              return activePublicCount > 9 ? (
                <div className="mt-5 text-center">
                  <Link
                    href={publicSellerShopPath(seller.id, seller.displayName)}
                    className="inline-block rounded-md border border-neutral-300 px-5 py-2 text-sm font-medium hover:bg-neutral-50"
                  >
                    See all {activePublicCount} pieces →
                  </Link>
                </div>
              ) : null;
            })()}
          </section>

          {/* Workshop Gallery */}
          {(seller.workshopImageUrl || (seller.galleryImageUrls && seller.galleryImageUrls.length > 0)) && (
            <section>
              <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">From the Workshop</h2>
              <SellerGallery
                workshopImageUrl={seller.workshopImageUrl}
                images={seller.galleryImageUrls ?? []}
                imageAltTexts={seller.galleryAltTexts ?? []}
              />
            </section>
          )}

          {/* Blog posts */}
          {sellerBlogPosts.length > 0 && (
            <section>
              <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Stories from the Workshop</h2>
              <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
                {sellerBlogPosts.map((p) => (
                  <li key={p.slug} className="card-listing min-w-[220px] flex-none snap-start sm:min-w-0">
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
        </div>
      </div>
    </main>
  );
}
