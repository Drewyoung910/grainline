// src/app/seller/[id]/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { safeJsonLd } from "@/lib/json-ld";
import { prisma } from "@/lib/db";
import MapCard from "@/components/MapCard";
import CustomOrderRequestForm from "@/components/CustomOrderRequestForm";
import FavoriteButton from "@/components/FavoriteButton";
import ClickTracker from "@/components/ClickTracker";
import { BLOG_TYPE_LABELS, BLOG_TYPE_COLORS } from "@/lib/blog";
import { Instagram, Facebook, Pinterest, TikTok, Globe, Hammer, MapPin } from "@/components/icons";
import GuildBadge from "@/components/GuildBadge";
import FollowButton from "@/components/FollowButton";
import BlockReportButton from "@/components/BlockReportButton";
import { getBlockedUserIdsFor } from "@/lib/blocks";
import SellerGallery from "@/components/SellerGallery";
import CoverLightbox from "@/components/CoverLightbox";
import ListingCard from "@/components/ListingCard";
import LocalDate from "@/components/LocalDate";
import { publicListingWhere } from "@/lib/listingVisibility";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    select: {
      displayName: true,
      bio: true,
      tagline: true,
      bannerImageUrl: true,
      avatarImageUrl: true,
      user: { select: { imageUrl: true } },
    },
  });
  if (!seller) return {};

  const name = seller.displayName ?? "Seller";
  const title = `${name} — Handmade Woodworking on Grainline`;
  const description =
    seller.bio?.slice(0, 160) ||
    seller.tagline ||
    `Shop handmade woodworking pieces by ${name} on Grainline`;

  const firstPhoto = await prisma.listing.findFirst({
    where: publicListingWhere({ sellerId: id }),
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
    alternates: { canonical: `https://thegrainline.com/seller/${id}` },
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

  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, clerkId: true, name: true, imageUrl: true, banned: true } },
      faqs: { orderBy: { sortOrder: "asc" } },
      metro: { select: { slug: true, name: true, state: true } },
      cityMetro: { select: { slug: true, name: true, state: true } },
    },
  });

  if (!seller) return notFound();
  if (seller.user?.banned) return notFound();

  // Current viewer
  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }

  // Block check — return 404 if the viewer has blocked or been blocked by the seller
  const blockedUserIds = await getBlockedUserIdsFor(meId);
  if (seller.user?.id && blockedUserIds.has(seller.user.id)) {
    return notFound();
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
    where: { sellerProfileId: seller.id, status: "PUBLISHED", author: { banned: false, deletedAt: null } },
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

  // Query reviews by sellerId so private listing reviews are included
  let shopRating: { avg: number; count: number } | null = null;
  const ratingResult = await prisma.$queryRaw<Array<{ avg: number; count: bigint }>>`
    SELECT AVG(r."ratingX2")::float / 2.0 AS avg, COUNT(r.id) AS count
    FROM "Review" r
    JOIN "Listing" l ON l.id = r."listingId"
    WHERE l."sellerId" = ${seller.id}
    HAVING COUNT(r.id) > 0
  `;
  if (ratingResult.length > 0 && Number(ratingResult[0].count) > 0) {
    shopRating = { avg: ratingResult[0].avg, count: Number(ratingResult[0].count) };
  }

  // ── JSON-LD ─────────────────────────────────────────────────────────────────
  const businessLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: seller.displayName ?? "Seller",
    description: seller.bio ?? undefined,
    url: `https://thegrainline.com/seller/${seller.id}`,
    knowsAbout: "Handmade Woodworking",
    ...(cityState
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: seller.city ?? undefined,
            addressRegion: seller.state ?? undefined,
          },
        }
      : {}),
    ...(lat != null && lng != null
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

  // Fire-and-forget profile view increment (don't await — don't slow page load)
  prisma.sellerProfile.update({
    where: { id: seller.id },
    data: { profileViews: { increment: 1 } },
  }).catch(() => {});

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
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

      {/* ── Banner ────────────────────────────────────────────────────────── */}
      <div className="relative h-48 sm:h-56">
        {seller.bannerImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={seller.bannerImageUrl}
            alt={`${seller.displayName} banner`}
            fetchPriority="high"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-r from-neutral-800 to-neutral-600" />
        )}
        {/* Avatar: sits at bottom of banner, half-overlapping downward */}
        <div className="absolute bottom-0 left-8 translate-y-1/2 h-24 w-24 rounded-full overflow-hidden ring-4 ring-white shadow">
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

      <div className="px-6 sm:px-8 pb-8">
        {/* Name row — pt-16 clears the avatar overlap (half of h-24 = 48px + 16px gap) */}
        <div className="pt-16">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{seller.displayName}</h1>
                <GuildBadge level={seller.guildLevel} showLabel={true} size={36} />
              </div>
              {seller.tagline && (
                <p className="text-sm text-neutral-600 mt-0.5">{seller.tagline}</p>
              )}
              {cityState && (
                <p className="text-sm text-neutral-500 mt-0.5">{cityState}</p>
              )}
              {meId !== seller.userId && (
                <div className="mt-2 flex items-center gap-2">
                  <FollowButton
                    sellerProfileId={seller.id}
                    sellerUserId={seller.userId}
                    initialFollowing={isFollowing}
                    initialCount={followerCount}
                    size="sm"
                  />
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
            </div>
            <Link href="/browse" className="text-sm underline text-neutral-600 shrink-0 mt-1">
              &larr; Back to Browse
            </Link>
          </div>
        </div>

        {/* Meta row: years, rating, availability badges */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-neutral-600 mb-4">
          {seller.yearsInBusiness != null && (
            <span>{seller.yearsInBusiness} {seller.yearsInBusiness === 1 ? "year" : "years"} in business</span>
          )}
          {shopRating && shopRating.count > 0 && (
            <span className="flex items-center gap-1">
              <StarsInline value={shopRating.avg} />
              <span className="font-medium text-neutral-700">
                {(Math.round(shopRating.avg * 10) / 10).toFixed(1)}
              </span>
              <span className="text-neutral-400">({shopRating.count})</span>
            </span>
          )}
          {seller.acceptsCustomOrders && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
              Accepting custom orders
            </span>
          )}
          {!seller.acceptingNewOrders && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              Not currently taking new orders
            </span>
          )}
        </div>

        {/* Custom order button */}
        {seller.acceptsCustomOrders && (
          <div className="mb-4">
            {meId && meId !== seller.userId ? (
              <CustomOrderRequestForm
                sellerUserId={seller.userId}
                sellerName={seller.displayName}
                triggerLabel="Request a Custom Piece"
                triggerClassName="inline-flex items-center gap-2 rounded-lg bg-amber-800 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700"
              />
            ) : !meId ? (
              <Link
                href={`/sign-in?redirect_url=/seller/${id}`}
                className="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                <Hammer size={15} />
                Request a Custom Piece
              </Link>
            ) : null}
          </div>
        )}

        {/* Social links */}
        {socialLinks.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-6">
            {socialLinks.map(({ label, url, Icon }) => (
              <a
                key={label}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={label}
                className="text-neutral-600 hover:text-neutral-900"
              >
                <Icon size={20} />
              </a>
            ))}
          </div>
        )}

        {/* ── Latest Broadcast ───────────────────────────────────────────── */}
        {latestBroadcast && broadcastAgeDays !== null && broadcastAgeDays < 30 && (
          <section className="mb-8 border border-teal-200 bg-teal-50 p-4">
            <div className="text-xs text-teal-600 font-medium mb-1">
              Shop Update ·{" "}
              <LocalDate date={latestBroadcast.sentAt} />
            </div>
            <p className="text-sm text-neutral-700 whitespace-pre-line">{latestBroadcast.message}</p>
            {latestBroadcast.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={latestBroadcast.imageUrl} alt="Update" className="mt-3 w-full max-h-48 object-cover" />
            )}
          </section>
        )}

        {/* ── Featured Listings ──────────────────────────────────────────── */}
        {featuredListings.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Featured Work</h2>
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

        {/* ── Story ─────────────────────────────────────────────────────── */}
        {(seller.storyTitle || seller.storyBody) && (
          <section className="mb-8 card-section p-6">
            {seller.storyTitle && (
              <h2 className="text-lg font-semibold mb-3">{seller.storyTitle}</h2>
            )}
            {seller.storyBody && (
              <p className="text-neutral-700 whitespace-pre-line">
                {seller.storyBody}
              </p>
            )}
          </section>
        )}

        {/* ── Bio ───────────────────────────────────────────────────────── */}
        {seller.bio && !(seller.storyTitle || seller.storyBody) && (
          <section className="mb-8 card-section p-6">
            <h2 className="text-lg font-semibold mb-2">About</h2>
            <p className="text-neutral-700 whitespace-pre-line">{seller.bio}</p>
          </section>
        )}

        {/* ── Location / Map ────────────────────────────────────────────── */}
        {lat != null && lng != null && (
          <section className="mb-8 card-section p-4 space-y-3">
            <h2 className="text-lg font-medium">Pickup area</h2>
            <MapCard
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

        {/* ── More makers in this city ──────────────────────────────────── */}
        {(seller.cityMetro ?? seller.metro) && (() => {
          const m = seller.cityMetro ?? seller.metro!;
          return (
            <div className="mb-8 space-y-1">
              <Link href={`/makers/${m.slug}`} className="text-sm text-neutral-600 hover:underline block">
                More makers in {m.name}, {m.state} →
              </Link>
              <Link href={`/browse/${m.slug}`} className="text-sm text-neutral-600 hover:underline block">
                Browse {m.name}, {m.state} listings →
              </Link>
            </div>
          );
        })()}

        {/* ── Workshop Gallery ───────────────────────────────────────────── */}
        {(seller.workshopImageUrl || (seller.galleryImageUrls && seller.galleryImageUrls.length > 0)) && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">From the Workshop</h2>
            <SellerGallery
              workshopImageUrl={seller.workshopImageUrl}
              images={seller.galleryImageUrls ?? []}
            />
          </section>
        )}

        {/* ── Shop Policies ──────────────────────────────────────────────── */}
        {(seller.returnPolicy || seller.customOrderPolicy || seller.shippingPolicy) && (
          <section className="mb-8 card-section">
            <h2 className="text-lg font-semibold px-6 py-4 border-b border-neutral-100">Shop Policies</h2>
            {seller.returnPolicy && (
              <details className="border-b last:border-b-0">
                <summary className="cursor-pointer px-6 py-3 font-medium text-sm hover:bg-neutral-50">
                  Return Policy
                </summary>
                <p className="px-6 pb-4 text-sm text-neutral-700 whitespace-pre-line">
                  {seller.returnPolicy}
                </p>
              </details>
            )}
            {seller.customOrderPolicy && (
              <details className="border-b last:border-b-0">
                <summary className="cursor-pointer px-6 py-3 font-medium text-sm hover:bg-neutral-50">
                  Custom Order Policy
                </summary>
                <p className="px-6 pb-4 text-sm text-neutral-700 whitespace-pre-line">
                  {seller.customOrderPolicy}
                </p>
              </details>
            )}
            {seller.shippingPolicy && (
              <details className="border-b last:border-b-0">
                <summary className="cursor-pointer px-6 py-3 font-medium text-sm hover:bg-neutral-50">
                  Shipping Policy
                </summary>
                <p className="px-6 pb-4 text-sm text-neutral-700 whitespace-pre-line">
                  {seller.shippingPolicy}
                </p>
              </details>
            )}
          </section>
        )}

        {/* ── FAQs ──────────────────────────────────────────────────────── */}
        {seller.faqs.length > 0 && (
          <section className="mb-8 card-section">
            <h2 className="text-lg font-semibold px-6 py-4 border-b border-neutral-100">
              Frequently Asked Questions
            </h2>
            {seller.faqs.map((faq) => (
              <details key={faq.id} className="border-b last:border-b-0">
                <summary className="cursor-pointer px-6 py-3 font-medium text-sm hover:bg-neutral-50">
                  {faq.question}
                </summary>
                <p className="px-6 pb-4 text-sm text-neutral-700 whitespace-pre-line">
                  {faq.answer}
                </p>
              </details>
            ))}
          </section>
        )}

        {/* ── From the Workshop (blog posts) ──────────────────────────── */}
        {sellerBlogPosts.length > 0 && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">From the Workshop</h2>
            <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-3 sm:overflow-visible sm:pb-0">
              {sellerBlogPosts.map((p) => (
                <li key={p.slug} className="card-listing min-w-[200px] flex-none snap-start sm:min-w-0">
                  <Link href={`/blog/${p.slug}`} className="block">
                    <div className="h-36 bg-neutral-100 overflow-hidden">
                      {p.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.coverImageUrl} alt={p.title} className="w-full h-full object-cover" />
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
                        <div className="text-xs text-neutral-400">
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

        {/* ── All Listings ───────────────────────────────────────────────── */}
        <section>
          {(() => {
            const activePublicCount = listings.filter(
              (l) => l.status === "ACTIVE" && !l.isPrivate
            ).length;
            return (
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">All Listings</h2>
            {activePublicCount > 0 && (
              <Link
                href={`/seller/${id}/shop`}
                className="text-sm text-neutral-600 underline hover:text-neutral-900"
              >
                See all {activePublicCount} {activePublicCount === 1 ? "piece" : "pieces"} →
              </Link>
            )}
          </div>
            );
          })()}
          {listings.length === 0 ? (
            <div className="card-section p-6 text-neutral-600">
              No listings yet.
            </div>
          ) : (
            <ul className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 sm:grid sm:grid-cols-2 sm:overflow-visible sm:pb-0 md:grid-cols-3 sm:gap-6">
              {listings.slice(0, 8).map((l) => (
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
            const activePublicCount = listings.filter(
              (l) => l.status === "ACTIVE" && !l.isPrivate
            ).length;
            return activePublicCount > 8 ? (
              <div className="mt-4 text-center">
                <Link
                  href={`/seller/${id}/shop`}
                  className="inline-block rounded border border-neutral-300 px-5 py-2 text-sm font-medium hover:bg-neutral-50"
                >
                  See all {activePublicCount} pieces →
                </Link>
              </div>
            ) : null;
          })()}
        </section>
      </div>
    </main>
  );
}
