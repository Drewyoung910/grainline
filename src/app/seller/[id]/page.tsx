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

  // ── Stat band data ─────────────────────────────────────────────────────────
  const [soldCount, recentShipped, tagRows, customerPhotos, customerPhotoTotal] = await Promise.all([
    prisma.orderItem.count({
      where: { listing: { sellerId: seller.id }, order: { paidAt: { not: null } } },
    }),
    prisma.order.findMany({
      where: {
        paidAt: { not: null },
        shippedAt: { not: null },
        items: { some: { listing: { sellerId: seller.id } } },
      },
      orderBy: { shippedAt: "desc" },
      take: 30,
      select: { paidAt: true, shippedAt: true },
    }),
    prisma.$queryRaw<{ tag: string; count: bigint }[]>`
      SELECT tag, COUNT(*) AS count
      FROM "Listing" l, unnest(l.tags) AS tag
      WHERE l."sellerId" = ${seller.id}
        AND l.status = 'ACTIVE'
        AND l."isPrivate" = false
      GROUP BY tag
      ORDER BY COUNT(*) DESC
      LIMIT 8
    `,
    prisma.reviewPhoto.findMany({
      where: { review: { listing: { sellerId: seller.id } } },
      orderBy: { review: { createdAt: "desc" } },
      take: 12,
      select: {
        id: true,
        url: true,
        altText: true,
        review: { select: { listingId: true, reviewerId: true, listing: { select: { title: true } } } },
      },
    }),
    prisma.reviewPhoto.count({
      where: { review: { listing: { sellerId: seller.id } } },
    }),
  ]);

  const avgShipDays = recentShipped.length >= 3
    ? Math.max(
        1,
        Math.round(
          recentShipped.reduce(
            (sum, o) => sum + (o.shippedAt!.getTime() - o.paidAt!.getTime()) / (24 * 60 * 60 * 1000),
            0,
          ) / recentShipped.length,
        ),
      )
    : null;

  const topTags = tagRows.map((r) => r.tag);
  const memberSinceYear = seller.createdAt.getFullYear();
  const isNewSeller = soldCount === 0 && (shopRating?.count ?? 0) === 0;

  const customerPhotoReviewerCount = new Set(customerPhotos.map((p) => p.review.reviewerId)).size;

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
                <p className="text-base text-neutral-700 mt-1 italic max-w-2xl">{seller.tagline}</p>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-neutral-600 mt-2">
                {cityState && (
                  <span className="flex items-center gap-1">
                    <MapPin size={14} className="shrink-0" />
                    {cityState}
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
      </section>

      {/* ── Two-column body: main rhythm + sticky CTA sidebar ───────────── */}
      <div className="mt-6 pb-12 px-2 sm:px-4 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_280px] gap-6 lg:gap-10">

        {/* ── Main content column ───────────────────────────────────────── */}
        <div className="min-w-0 space-y-10">

          {/* Stat band */}
          <section className="rounded-2xl bg-[#EFEAE0] px-5 sm:px-8 py-5">
            {isNewSeller ? (
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm text-neutral-700">
                <span>
                  <span className="font-display text-xl font-bold text-neutral-900">{memberSinceYear}</span>{" "}
                  member since
                </span>
                <span className="text-amber-800 italic">Recently joined Grainline</span>
              </div>
            ) : (
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-sm text-neutral-700">
                {soldCount > 0 && (
                  <div>
                    <div className="font-display text-2xl font-bold text-neutral-900 leading-none">
                      {soldCount.toLocaleString("en-US")}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {soldCount === 1 ? "piece sold" : "pieces sold"}
                    </div>
                  </div>
                )}
                {shopRating && shopRating.count > 0 && (
                  <div>
                    <div className="font-display text-2xl font-bold text-neutral-900 leading-none flex items-baseline gap-1">
                      {(Math.round(shopRating.avg * 10) / 10).toFixed(1)}
                      <span className="text-amber-500 text-xl">★</span>
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      from {shopRating.count.toLocaleString("en-US")} {shopRating.count === 1 ? "review" : "reviews"}
                    </div>
                  </div>
                )}
                {avgShipDays != null && (
                  <div>
                    <div className="font-display text-2xl font-bold text-neutral-900 leading-none">
                      {avgShipDays}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {avgShipDays === 1 ? "day to ship" : "days to ship"}
                    </div>
                  </div>
                )}
                {seller.yearsInBusiness != null && seller.yearsInBusiness > 0 && (
                  <div>
                    <div className="font-display text-2xl font-bold text-neutral-900 leading-none">
                      {seller.yearsInBusiness}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {seller.yearsInBusiness === 1 ? "year crafting" : "years crafting"}
                    </div>
                  </div>
                )}
                <div>
                  <div className="font-display text-2xl font-bold text-neutral-900 leading-none">
                    {memberSinceYear}
                  </div>
                  <div className="text-xs text-neutral-500 mt-0.5">member since</div>
                </div>
              </div>
            )}
          </section>

          {/* What I make tag chips */}
          {topTags.length >= 3 && (
            <section>
              <div className="text-xs uppercase tracking-wider text-neutral-500 font-semibold mb-3">
                What I make
              </div>
              <div className="flex flex-wrap gap-2">
                {topTags.map((tag) => (
                  <Link
                    key={tag}
                    href={`${publicSellerShopPath(seller.id, seller.displayName)}?tag=${encodeURIComponent(tag)}`}
                    className="rounded-full bg-stone-100 hover:bg-stone-200 text-neutral-700 px-3 py-1 text-sm transition-colors"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Latest broadcast */}
          {latestBroadcast && broadcastAgeDays !== null && broadcastAgeDays < 30 && (
            <section className="rounded-2xl bg-amber-50 border border-amber-100 p-5 sm:p-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800 mb-2">
                Shop update · <LocalDate date={latestBroadcast.sentAt} />
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
                  <div className="grid grid-cols-1 lg:grid-cols-3 lg:grid-rows-2 gap-4 lg:gap-5">
                    <div className="lg:col-span-2 lg:row-span-2 transition-transform hover:-translate-y-1 duration-200">
                      <ClickTracker listingId={hero.id}>
                        <ListingCard listing={wrap(hero)} initialSaved={savedSet.has(hero.id)} variant="grid" />
                      </ClickTracker>
                    </div>
                    <div className="transition-transform hover:-translate-y-1 duration-200">
                      <ClickTracker listingId={second.id}>
                        <ListingCard listing={wrap(second)} initialSaved={savedSet.has(second.id)} variant="grid" />
                      </ClickTracker>
                    </div>
                    <div className="transition-transform hover:-translate-y-1 duration-200">
                      <ClickTracker listingId={third.id}>
                        <ListingCard listing={wrap(third)} initialSaved={savedSet.has(third.id)} variant="grid" />
                      </ClickTracker>
                    </div>
                  </div>
                </section>
              );
            }
            if (fallbackFeatured.length === 2) {
              return (
                <section>
                  <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Featured Work</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {fallbackFeatured.map((l) => (
                      <div key={l.id} className="transition-transform hover:-translate-y-1 duration-200">
                        <ClickTracker listingId={l.id}>
                          <ListingCard listing={wrap(l)} initialSaved={savedSet.has(l.id)} variant="grid" />
                        </ClickTracker>
                      </div>
                    ))}
                  </div>
                </section>
              );
            }
            return (
              <section>
                <h2 className="text-xl sm:text-2xl font-display font-semibold mb-4">Featured Work</h2>
                <div className="max-w-xl transition-transform hover:-translate-y-1 duration-200">
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
                    <MediaImage
                      src={seller.workshopImageUrl}
                      alt={`${seller.displayName} workshop`}
                      className="w-full h-full object-cover"
                      fallbackClassName="w-full h-full bg-gradient-to-br from-amber-50 to-stone-100"
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
              <div className="columns-2 sm:columns-3 lg:columns-4 gap-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
                {customerPhotos.map((p) => (
                  <Link
                    key={p.id}
                    href={`/listing/${p.review.listingId}#reviews`}
                    className="block overflow-hidden rounded-lg ring-1 ring-neutral-200 transition-transform hover:-translate-y-0.5 duration-200"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.url}
                      alt={p.altText ?? `Customer photo of ${p.review.listing?.title ?? "a piece"}`}
                      loading="lazy"
                      className="w-full h-auto object-cover"
                    />
                  </Link>
                ))}
              </div>
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

          {/* Pickup map | Policies + FAQ two-column */}
          {(lat != null && lng != null) || seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy || seller.faqs.length > 0 ? (
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {lat != null && lng != null && (
                <div className="card-section p-4 bg-white space-y-3">
                  <h2 className="text-lg font-display font-semibold">Pickup area</h2>
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
                </div>
              )}
              <div className="space-y-4">
                {(seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy) && (
                  <div className="card-section bg-white">
                    <h2 className="text-lg font-display font-semibold px-5 py-3 border-b border-neutral-100">Shop Policies</h2>
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
                  </div>
                )}
                {seller.faqs.length > 0 && (
                  <div className="card-section bg-white">
                    <h2 className="text-lg font-display font-semibold px-5 py-3 border-b border-neutral-100">FAQs</h2>
                    {seller.faqs.map((faq) => (
                      <details key={faq.id} className="border-b border-neutral-100 last:border-b-0">
                        <summary className="cursor-pointer px-5 py-3 font-medium text-sm hover:bg-neutral-50">{faq.question}</summary>
                        <p className="px-5 pb-4 text-sm text-neutral-700 whitespace-pre-line">{faq.answer}</p>
                      </details>
                    ))}
                  </div>
                )}
              </div>
            </section>
          ) : null}

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

          {/* More from city */}
          {(seller.cityMetro ?? seller.metro) && (() => {
            const m = seller.cityMetro ?? seller.metro!;
            return (
              <section className="text-center text-sm text-neutral-600 space-y-1">
                <Link href={`/makers/${m.slug}`} className="text-amber-700 hover:underline block">
                  More makers in {m.name}, {m.state} →
                </Link>
                <Link href={`/browse/${m.slug}`} className="text-amber-700 hover:underline block">
                  Browse {m.name}, {m.state} listings →
                </Link>
              </section>
            );
          })()}
        </div>

        {/* ── Sticky CTA sidebar (lg+ only) ──────────────────────────────── */}
        <aside className="hidden lg:block">
          <div className="sticky top-6 card-section bg-white p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-neutral-200 ring-1 ring-neutral-200 shadow-sm">
                {seller.avatarImageUrl ?? seller.user?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={(seller.avatarImageUrl ?? seller.user?.imageUrl)!}
                    alt={seller.displayName}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="h-full w-full bg-amber-200 flex items-center justify-center text-amber-800 font-bold">
                    {(seller.displayName || "M")[0]?.toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="font-display font-semibold text-sm truncate">{seller.displayName}</div>
                  <GuildBadge level={seller.guildLevel} size={20} />
                </div>
                {shopRating && shopRating.count > 0 && (
                  <div className="text-xs text-neutral-600 flex items-center gap-1">
                    <span className="text-amber-500">★</span>
                    <span>{(Math.round(shopRating.avg * 10) / 10).toFixed(1)}</span>
                    <span className="text-neutral-500">({shopRating.count})</span>
                  </div>
                )}
              </div>
            </div>

            {meId !== seller.userId ? (
              <div className="space-y-2">
                <Link
                  href={meId ? `/messages/new?to=${seller.userId}` : `/sign-in?redirect_url=${encodeURIComponent(publicSellerPath(seller.id, seller.displayName))}`}
                  className="block w-full text-center rounded-md bg-[#2C1F1A] text-white px-4 py-2.5 text-sm font-semibold hover:bg-[#3A2A24] transition-colors"
                >
                  Message Maker
                </Link>
                <FollowButton
                  sellerProfileId={seller.id}
                  sellerUserId={seller.userId}
                  initialFollowing={isFollowing}
                  initialCount={followerCount}
                  size="sm"
                />
                {seller.acceptsCustomOrders && (
                  meId ? (
                    <CustomOrderRequestForm
                      sellerUserId={seller.userId}
                      sellerName={seller.displayName}
                      triggerLabel="Request a Custom Piece"
                      triggerClassName="block w-full text-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                    />
                  ) : (
                    <Link
                      href={`/sign-in?redirect_url=${encodeURIComponent(publicSellerPath(seller.id, seller.displayName))}`}
                      className="block w-full text-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
                    >
                      Request a Custom Piece
                    </Link>
                  )
                )}
                <Link
                  href={publicSellerShopPath(seller.id, seller.displayName)}
                  className="block text-center text-sm text-neutral-600 underline hover:text-neutral-900 pt-1"
                >
                  Visit shop
                </Link>
                {meId && (
                  <div className="pt-2 border-t border-neutral-100 flex justify-center">
                    <BlockReportButton
                      targetUserId={seller.userId}
                      targetName={seller.displayName ?? "this maker"}
                      targetType="SELLER"
                      targetId={seller.id}
                    />
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-neutral-500 italic">This is your public profile.</p>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
