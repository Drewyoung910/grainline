// src/app/browse/[metroSlug]/[category]/page.tsx
// City + category filtered browse page — e.g. /browse/austin-tx/furniture

import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { ListingStatus, Category } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";

const BASE_URL = "https://thegrainline.com";

// ---------------------------------------------------------------------------
// generateStaticParams — metro × category combos that have listings
// ---------------------------------------------------------------------------
export async function generateStaticParams() {
  const metros = await prisma.metro.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, parentMetroId: true },
  });

  const results: { metroSlug: string; category: string }[] = [];

  for (const metro of metros) {
    const isMajor = !metro.parentMetroId;
    const groups = await prisma.listing.groupBy({
      by: ["category"],
      where: {
        status: ListingStatus.ACTIVE,
        isPrivate: false,
        category: { not: null },
        ...(isMajor ? { metroId: metro.id } : { cityMetroId: metro.id }),
      },
      _count: { _all: true },
    });
    for (const g of groups) {
      if (g.category && g._count._all > 0) {
        results.push({ metroSlug: metro.slug, category: g.category.toLowerCase() });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// generateMetadata
// ---------------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ metroSlug: string; category: string }>;
}): Promise<Metadata> {
  const { metroSlug, category } = await params;

  const categoryKey = category.toUpperCase();
  if (!CATEGORY_VALUES.includes(categoryKey)) return {};

  const metro = await prisma.metro.findUnique({
    where: { slug: metroSlug },
    select: { name: true, state: true },
  });
  if (!metro) return {};

  const label = CATEGORY_LABELS[categoryKey] ?? categoryKey;
  const cityName = `${metro.name}, ${metro.state}`;
  const title = `Handmade ${label} in ${cityName} | Grainline`;
  const description = `Shop handmade ${label.toLowerCase()} from local woodworking artisans in ${cityName}. Custom made to order or ready to ship.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/browse/${metroSlug}/${category.toLowerCase()}` },
    openGraph: { title, description, url: `${BASE_URL}/browse/${metroSlug}/${category.toLowerCase()}` },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function BrowseMetroCategoryPage({
  params,
}: {
  params: Promise<{ metroSlug: string; category: string }>;
}) {
  const { metroSlug, category } = await params;

  const categoryKey = category.toUpperCase();
  if (!CATEGORY_VALUES.includes(categoryKey)) return notFound();

  const metro = await prisma.metro.findUnique({
    where: { slug: metroSlug },
    select: { id: true, name: true, state: true, parentMetroId: true },
  });
  if (!metro) return notFound();

  const isMajorMetro = !metro.parentMetroId;
  const cityName = `${metro.name}, ${metro.state}`;
  const categoryLabel = CATEGORY_LABELS[categoryKey] ?? categoryKey;

  const listingWhere = {
    status: ListingStatus.ACTIVE,
    isPrivate: false,
    category: categoryKey as Category,
    seller: { vacationMode: false, chargesEnabled: true, user: { banned: false } },
    ...(isMajorMetro ? { metroId: metro.id } : { cityMetroId: metro.id }),
  };

  const { userId } = await auth();
  let savedSet = new Set<string>();
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    if (me) {
      const favs = await prisma.favorite.findMany({ where: { userId: me.id }, select: { listingId: true } });
      savedSet = new Set(favs.map((f) => f.listingId));
    }
  }

  const [listings, listingCount] = await Promise.all([
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
  ]);

  // JSON-LD
  const itemListLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `Handmade ${categoryLabel} in ${cityName}`,
    "url": `${BASE_URL}/browse/${metroSlug}/${category.toLowerCase()}`,
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
      { "@type": "ListItem", "position": 5, "name": categoryLabel, "item": `${BASE_URL}/browse/${metroSlug}/${category.toLowerCase()}` },
    ],
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbLd) }} />

      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-neutral-500">
        <Link href="/" className="hover:underline">Home</Link>
        <span className="mx-2">›</span>
        <Link href="/browse" className="hover:underline">Browse</Link>
        <span className="mx-2">›</span>
        <Link href={`/browse/${metroSlug}`} className="hover:underline">{metro.name}</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{categoryLabel}</span>
      </nav>

      <h1 className="text-2xl font-bold text-neutral-900 mb-2">
        Handmade {categoryLabel} in {cityName}
      </h1>
      <p className="text-neutral-600 text-sm mb-6">
        Shop {listingCount} handmade {categoryLabel.toLowerCase()} piece{listingCount !== 1 ? "s" : ""} from local artisans in {cityName}. Custom made to order or ready to ship.
      </p>

      {/* Category tabs */}
      <div className="flex overflow-x-auto gap-2 pb-2 mb-6">
        <Link
          href={`/browse/${metroSlug}`}
          className="flex-none text-sm border border-neutral-200 px-4 py-1.5 hover:bg-neutral-50 transition-colors"
        >
          All
        </Link>
        {CATEGORY_VALUES.map((cat) => (
          <Link
            key={cat}
            href={`/browse/${metroSlug}/${cat.toLowerCase()}`}
            className={`flex-none text-sm border px-4 py-1.5 transition-colors whitespace-nowrap ${
              cat === categoryKey
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            {CATEGORY_LABELS[cat]}
          </Link>
        ))}
      </div>

      {listingCount === 0 ? (
        <div className="border border-neutral-200 p-8 text-center">
          <p className="text-neutral-500 mb-4">No {categoryLabel.toLowerCase()} listings in {cityName} yet.</p>
          <Link href={`/browse/${metroSlug}`} className="text-sm border border-neutral-300 px-4 py-2 hover:bg-neutral-50 transition-colors">
            View all pieces in {metro.name}
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
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
    </main>
  );
}
