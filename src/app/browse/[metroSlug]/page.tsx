// src/app/browse/[metroSlug]/page.tsx
// City-level browse page — e.g. /browse/austin-tx, /browse/katy-tx
// Major metro pages aggregate all child metros; child metro pages show only that city.

import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { ListingStatus } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { safeJsonLd } from "@/lib/json-ld";

const BASE_URL = "https://thegrainline.com";

// ---------------------------------------------------------------------------
// generateStaticParams — only metros with at least one active listing or seller
// ---------------------------------------------------------------------------
export async function generateStaticParams() {
  const metros = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        { listings: { some: { status: ListingStatus.ACTIVE } } },
        { listingCityMetros: { some: { status: ListingStatus.ACTIVE } } },
        { sellerProfiles: { some: { chargesEnabled: true } } },
        { sellerCityProfiles: { some: { chargesEnabled: true } } },
      ],
    },
    select: { slug: true },
  });
  return metros.map((m) => ({ metroSlug: m.slug }));
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ metroSlug: string }>;
}): Promise<Metadata> {
  const { metroSlug } = await params;
  const metro = await prisma.metro.findUnique({
    where: { slug: metroSlug },
    select: { name: true, state: true, parentMetroId: true },
  });
  if (!metro) return {};

  const isMajor = !metro.parentMetroId;
  const cityName = `${metro.name}, ${metro.state}`;

  // Count listings and sellers for description
  const [listingCount, sellerCount] = await Promise.all([
    prisma.listing.count({
      where: {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        ...(isMajor ? { metroId: (await prisma.metro.findUnique({ where: { slug: metroSlug }, select: { id: true } }))?.id } : { cityMetroId: (await prisma.metro.findUnique({ where: { slug: metroSlug }, select: { id: true } }))?.id }),
      },
    }),
    prisma.sellerProfile.count({
      where: {
        chargesEnabled: true,
        ...(isMajor ? { metroId: (await prisma.metro.findUnique({ where: { slug: metroSlug }, select: { id: true } }))?.id } : { cityMetroId: (await prisma.metro.findUnique({ where: { slug: metroSlug }, select: { id: true } }))?.id }),
      },
    }),
  ]);

  const title = `Handmade Woodworking in ${cityName} | Grainline`;
  const description = listingCount > 0
    ? `Discover ${listingCount} handmade piece${listingCount !== 1 ? "s" : ""} from ${sellerCount} local maker${sellerCount !== 1 ? "s" : ""} in ${cityName}. Custom furniture, cutting boards, home decor and more from artisans near you.`
    : `Custom woodworking in ${cityName} — browse handmade furniture, decor, and more from local artisans on Grainline.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/browse/${metroSlug}` },
    openGraph: { title, description, url: `${BASE_URL}/browse/${metroSlug}` },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function BrowseMetroPage({
  params,
}: {
  params: Promise<{ metroSlug: string }>;
}) {
  const { metroSlug } = await params;

  const metro = await prisma.metro.findUnique({
    where: { slug: metroSlug },
    select: {
      id: true,
      name: true,
      state: true,
      parentMetroId: true,
      parentMetro: { select: { id: true, slug: true, name: true } },
      childMetros: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!metro || !metro) return notFound();

  const isMajorMetro = !metro.parentMetroId;
  const cityName = `${metro.name}, ${metro.state}`;

  // Auth for favorites + block filter
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const meRow = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meDbId = meRow?.id ?? null;
  }
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);

  const listingWhere = {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    seller: { vacationMode: false, chargesEnabled: true, user: { banned: false } },
    ...(isMajorMetro ? { metroId: metro.id } : { cityMetroId: metro.id }),
    ...(blockedSellerIds.length > 0 ? { sellerId: { notIn: blockedSellerIds } } : {}),
  };

  let savedSet = new Set<string>();
  if (meDbId) {
    const favs = await prisma.favorite.findMany({ where: { userId: meDbId }, select: { listingId: true } });
    savedSet = new Set(favs.map((f) => f.listingId));
  }

  const [listings, listingCount, sellerCount] = await Promise.all([
    prisma.listing.findMany({
      where: listingWhere,
      orderBy: { createdAt: "desc" },
      take: 24,
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        status: true,
        listingType: true,
        stockQuantity: true,
        category: true,
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: {
          select: {
            id: true,
            displayName: true,
            avatarImageUrl: true,
            guildLevel: true,
            city: true,
            state: true,
            acceptingNewOrders: true,
            user: { select: { imageUrl: true } },
          },
        },
      },
    }),
    prisma.listing.count({ where: listingWhere }),
    prisma.sellerProfile.count({
      where: {
        chargesEnabled: true,
        vacationMode: false,
        user: { banned: false },
        ...(isMajorMetro ? { metroId: metro.id } : { cityMetroId: metro.id }),
      },
    }),
  ]);

  // Category counts for filter tabs
  const categoryCounts = await prisma.listing.groupBy({
    by: ["category"],
    where: { ...listingWhere, category: { not: null } },
    _count: { _all: true },
    orderBy: { _count: { category: "desc" } },
  });

  // Nearby metros with content
  const nearbyRaw = isMajorMetro
    ? metro.childMetros
    : [metro.parentMetro, ...metro.childMetros].filter(Boolean) as { id: string; slug: string; name: string }[];

  const nearbyIds = nearbyRaw.map((m) => m.id);
  const nearbyWithContent = nearbyIds.length > 0
    ? await prisma.metro.findMany({
        where: {
          id: { in: nearbyIds },
          isActive: true,
          OR: [
            { listings: { some: { status: ListingStatus.ACTIVE } } },
            { listingCityMetros: { some: { status: ListingStatus.ACTIVE } } },
          ],
        },
        select: { id: true, slug: true, name: true },
      })
    : [];

  // JSON-LD
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `Handmade Woodworking in ${cityName}`,
    "description": `Browse handmade woodworking pieces from local artisans in ${cityName}`,
    "url": `${BASE_URL}/browse/${metroSlug}`,
    "numberOfItems": listingCount,
    "itemListElement": listings.slice(0, 10).map((l, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "name": l.title,
      "url": `${BASE_URL}/listing/${l.id}`,
      "image": l.photos[0]?.url,
      "offers": { "@type": "Offer", "priceCurrency": l.currency.toUpperCase(), "price": (l.priceCents / 100).toFixed(2) },
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": "Browse", "item": `${BASE_URL}/browse` },
      { "@type": "ListItem", "position": 3, "name": metro.state },
      { "@type": "ListItem", "position": 4, "name": metro.name, "item": `${BASE_URL}/browse/${metroSlug}` },
    ],
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(itemListLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />

      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-neutral-500">
        <Link href="/" className="hover:underline">Home</Link>
        <span className="mx-2">›</span>
        <Link href="/browse" className="hover:underline">Browse</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-400">{metro.state}</span>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{metro.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-neutral-900 mb-2">
        Handmade Woodworking in {cityName}
      </h1>

      {listingCount > 0 ? (
        <p className="text-neutral-600 text-sm mb-6">
          Discover {listingCount} handmade piece{listingCount !== 1 ? "s" : ""} from {sellerCount} local maker{sellerCount !== 1 ? "s" : ""} in {cityName}. From custom furniture to kitchen accessories, connect directly with makers in the {metro.name} area. Every piece is crafted by hand in {metro.state}.
        </p>
      ) : (
        <p className="text-neutral-600 text-sm mb-6">
          Custom woodworking in {cityName} — makers coming soon. Post a commission request to attract local woodworkers, or sign up to be notified when makers join in your area.
        </p>
      )}

      {/* Category filter tabs */}
      {categoryCounts.length > 0 && (
        <div className="flex overflow-x-auto gap-2 pb-2 mb-6">
          <Link
            href={`/browse/${metroSlug}`}
            className="flex-none text-sm border border-neutral-900 bg-neutral-900 text-white px-4 py-1.5"
          >
            All
          </Link>
          {categoryCounts.map(({ category, _count }) => {
            if (!category) return null;
            return (
              <Link
                key={category}
                href={`/browse/${metroSlug}/${category.toLowerCase()}`}
                className="flex-none text-sm border border-neutral-200 px-4 py-1.5 hover:bg-neutral-50 transition-colors whitespace-nowrap"
              >
                {CATEGORY_LABELS[category]} ({_count._all})
              </Link>
            );
          })}
        </div>
      )}

      {/* Listings grid or empty state */}
      {listingCount === 0 ? (
        <div className="border border-neutral-200 p-8 text-center mb-10">
          <p className="text-neutral-500 mb-4">No listings in {cityName} yet.</p>
          <Link href="/commission/new" className="inline-block bg-amber-500 text-white text-sm font-medium px-6 py-2.5 hover:bg-amber-600 transition-colors mr-3">
            Post a Commission Request
          </Link>
          <Link href="/browse" className="inline-block border border-neutral-300 text-sm px-6 py-2.5 hover:bg-neutral-50 transition-colors">
            Browse All
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
          {listings.map((listing) => (
            <ClickTracker key={listing.id} listingId={listing.id}>
              <ListingCard
                listing={{
                  id: listing.id,
                  title: listing.title,
                  priceCents: listing.priceCents,
                  currency: listing.currency,
                  status: listing.status,
                  listingType: listing.listingType,
                  stockQuantity: listing.stockQuantity ?? null,
                  photoUrl: listing.photos[0]?.url ?? null,
                  seller: {
                    id: listing.seller.id,
                    displayName: listing.seller.displayName ?? null,
                    avatarImageUrl: listing.seller.avatarImageUrl ?? listing.seller.user?.imageUrl ?? null,
                    guildLevel: listing.seller.guildLevel ?? null,
                    city: listing.seller.city ?? null,
                    state: listing.seller.state ?? null,
                    acceptingNewOrders: listing.seller.acceptingNewOrders ?? null,
                  },
                  rating: null,
                }}
                initialSaved={savedSet.has(listing.id)}
                variant="grid"
              />
            </ClickTracker>
          ))}
        </ul>
      )}

      {listingCount > 24 && (
        <div className="text-center mb-10">
          <Link href={`/browse?lat=${metro.id}`} className="text-sm text-neutral-500 hover:underline">
            Showing 24 of {listingCount} pieces — use filters on the main browse page for more
          </Link>
        </div>
      )}

      {/* Nearby areas */}
      {nearbyWithContent.length > 0 && (
        <section className="border-t border-neutral-100 pt-8 mb-8">
          <h2 className="text-sm font-semibold text-neutral-700 mb-3">Also see makers in</h2>
          <div className="flex flex-wrap gap-2">
            {nearbyWithContent.map((m) => (
              <Link
                key={m.id}
                href={`/browse/${m.slug}`}
                className="text-sm border border-neutral-200 px-3 py-1 hover:bg-neutral-50 transition-colors"
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Makers link */}
      <div className="border-t border-neutral-100 pt-8">
        <Link href={`/makers/${metroSlug}`} className="text-sm text-neutral-600 hover:underline">
          Meet the woodworkers in {cityName} →
        </Link>
      </div>
    </main>
  );
}
