// src/app/makers/[metroSlug]/page.tsx
// City-level makers/sellers page — e.g. /makers/austin-tx

import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ListingStatus } from "@prisma/client";
import GuildBadge from "@/components/GuildBadge";
import type { GuildLevelValue } from "@/components/GuildBadge";
import { safeJsonLd } from "@/lib/json-ld";
import { publicSellerPath } from "@/lib/publicPaths";

const BASE_URL = "https://thegrainline.com";

// ---------------------------------------------------------------------------
// generateStaticParams — only metros with at least one active seller
// ---------------------------------------------------------------------------
export async function generateStaticParams() {
  const metros = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
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

  const cityName = `${metro.name}, ${metro.state}`;
  const title = `Woodworkers & Furniture Makers in ${cityName} | Grainline`;
  const description = `Meet local woodworkers and furniture makers in ${cityName}. Browse their handcrafted work, read reviews, and commission custom pieces directly.`;

  return {
    title,
    description,
    alternates: { canonical: `${BASE_URL}/makers/${metroSlug}` },
    openGraph: { title, description, url: `${BASE_URL}/makers/${metroSlug}` },
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function MakersMetroPage({
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
      latitude: true,
      longitude: true,
      parentMetroId: true,
      parentMetro: { select: { id: true, slug: true, name: true } },
      childMetros: { select: { id: true, slug: true, name: true } },
    },
  });
  if (!metro) return notFound();

  const isMajorMetro = !metro.parentMetroId;
  const cityName = `${metro.name}, ${metro.state}`;

  const sellerWhere = {
    chargesEnabled: true,
    vacationMode: false,
    user: { banned: false, deletedAt: null },
    listings: { some: { status: ListingStatus.ACTIVE, isPrivate: false } },
    ...(isMajorMetro ? { metroId: metro.id } : { cityMetroId: metro.id }),
  };

  const sellers = await prisma.sellerProfile.findMany({
    where: sellerWhere,
    orderBy: { profileViews: "desc" },
    take: 24,
    select: {
      id: true,
      displayName: true,
      tagline: true,
      city: true,
      state: true,
      avatarImageUrl: true,
      bannerImageUrl: true,
      guildLevel: true,
      isVerifiedMaker: true,
      user: { select: { imageUrl: true } },
      listings: {
        where: { status: ListingStatus.ACTIVE, isPrivate: false },
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } } },
      },
      _count: {
        select: {
          listings: { where: { status: ListingStatus.ACTIVE, isPrivate: false } },
          followers: true,
        },
      },
    },
  });

  const sellerCount = await prisma.sellerProfile.count({ where: sellerWhere });

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
            { sellerProfiles: { some: { chargesEnabled: true } } },
            { sellerCityProfiles: { some: { chargesEnabled: true } } },
          ],
        },
        select: { id: true, slug: true, name: true },
      })
    : [];

  // JSON-LD — LocalBusiness collection
  const localBusinessLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "name": `Woodworkers & Furniture Makers in ${cityName}`,
    "description": `Local woodworking artisans in ${cityName}`,
    "url": `${BASE_URL}/makers/${metroSlug}`,
    "areaServed": { "@type": "City", "name": metro.name, "containedInPlace": { "@type": "State", "name": metro.state } },
    "numberOfItems": sellerCount,
    "itemListElement": sellers.slice(0, 10).map((s, i) => ({
      "@type": "ListItem",
      "position": i + 1,
      "item": {
        "@type": "LocalBusiness",
        "name": s.displayName,
        "description": s.tagline ?? `Handmade woodworking by ${s.displayName}`,
        "url": `${BASE_URL}${publicSellerPath(s.id, s.displayName)}`,
        "image": s.avatarImageUrl ?? s.user?.imageUrl,
        ...(s.city && s.state ? { "address": { "@type": "PostalAddress", "addressLocality": s.city, "addressRegion": s.state } } : {}),
        "knowsAbout": "Handmade Woodworking",
      },
    })),
  };

  const breadcrumbLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": BASE_URL },
      { "@type": "ListItem", "position": 2, "name": metro.state },
      { "@type": "ListItem", "position": 3, "name": metro.name, "item": `${BASE_URL}/makers/${metroSlug}` },
    ],
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 pb-16 pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(localBusinessLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumbLd) }} />

      {/* Breadcrumb */}
      <nav className="mb-5 text-sm text-neutral-500">
        <Link href="/" className="hover:underline">Home</Link>
        <span className="mx-2">›</span>
        <span className="text-neutral-400">{metro.state}</span>
        <span className="mx-2">›</span>
        <span className="text-neutral-800">{metro.name}</span>
      </nav>

      <h1 className="text-2xl font-bold text-neutral-900 mb-2">
        Woodworkers & Furniture Makers in {cityName}
      </h1>

      {sellerCount > 0 ? (
        <p className="text-neutral-600 text-sm mb-8">
          Meet {sellerCount} woodworker{sellerCount !== 1 ? "s" : ""} and furniture maker{sellerCount !== 1 ? "s" : ""} in {cityName}. Browse their handcrafted work, read reviews, and commission custom pieces directly.
        </p>
      ) : (
        <p className="text-neutral-600 text-sm mb-8">
          Custom woodworking in {cityName} — makers coming soon. Post a commission request to attract local woodworkers, or sign up to be notified when makers join in your area.
        </p>
      )}

      {sellerCount === 0 ? (
        <div className="border border-neutral-200 p-8 text-center mb-10">
          <p className="text-neutral-500 mb-4">No makers in {cityName} yet.</p>
          <Link href="/commission/new" className="inline-block bg-amber-500 text-white text-sm font-medium px-6 py-2.5 hover:bg-amber-600 transition-colors">
            Post a Commission Request
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {sellers.map((seller) => {
            const avatar = seller.avatarImageUrl ?? seller.user?.imageUrl;
            const coverPhoto = seller.bannerImageUrl ?? seller.listings[0]?.photos[0]?.url;
            const activeCount = seller._count.listings;
            return (
              <li key={seller.id} className="border border-neutral-200">
                {/* Cover photo from latest listing */}
                {coverPhoto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={coverPhoto} alt="" className="w-full h-36 object-cover" />
                ) : (
                  <div className="w-full h-36 bg-stone-100" />
                )}
                <div className="p-4">
                  <div className="flex items-center gap-3 mb-2">
                    {avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={avatar} alt={seller.displayName} className="w-10 h-10 rounded-full object-cover flex-none" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-neutral-200 flex-none" />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-sm text-neutral-900 truncate">{seller.displayName}</span>
                        <GuildBadge level={seller.guildLevel as GuildLevelValue} size={22} />
                      </div>
                      {seller.city && seller.state && (
                        <p className="text-xs text-neutral-400">{seller.city}, {seller.state}</p>
                      )}
                    </div>
                  </div>
                  {seller.tagline && (
                    <p className="text-xs text-neutral-600 line-clamp-2 mb-3">{seller.tagline}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-neutral-400">
                      {activeCount} active piece{activeCount !== 1 ? "s" : ""}
                    </span>
                    <Link
                      href={publicSellerPath(seller.id, seller.displayName)}
                      className="text-xs border border-neutral-900 px-3 py-1 hover:bg-neutral-900 hover:text-white transition-colors"
                    >
                      View Shop
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Nearby areas */}
      {nearbyWithContent.length > 0 && (
        <section className="border-t border-neutral-100 pt-8 mb-8">
          <h2 className="text-sm font-semibold text-neutral-700 mb-3">Also see makers in</h2>
          <div className="flex flex-wrap gap-2">
            {nearbyWithContent.map((m) => (
              <Link
                key={m.id}
                href={`/makers/${m.slug}`}
                className="text-sm border border-neutral-200 px-3 py-1 hover:bg-neutral-50 transition-colors"
              >
                {m.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Map + browse links */}
      <div className="border-t border-neutral-100 pt-8 flex flex-col sm:flex-row sm:items-center gap-4">
        <Link href={`/browse/${metroSlug}`} className="text-sm text-neutral-600 hover:underline">
          Browse handmade pieces in {cityName} →
        </Link>
        {metro.latitude != null && metro.longitude != null && (
          <Link
            href={`/map?near=${metro.latitude},${metro.longitude}&zoom=10`}
            className="text-sm text-neutral-600 hover:underline"
          >
            View makers on map →
          </Link>
        )}
      </div>
    </main>
  );
}
