// src/app/sitemap.ts
import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";
import { CATEGORY_VALUES } from "@/lib/categories";
import { publicListingWhere } from "@/lib/listingVisibility";
import { publicListingPath, publicSellerPath, publicSellerShopPath } from "@/lib/publicPaths";
import { openCommissionWhere } from "@/lib/commissionExpiry";

const BASE_URL = "https://thegrainline.com";
const SITEMAP_ENTRY_LIMIT = 50_000;
const SITEMAP_CHUNK_SIZE = 5_000;

export async function generateSitemaps() {
  const listingCount = await prisma.listing.count({ where: publicListingWhere() });
  const listingChunks = Math.ceil(listingCount / SITEMAP_CHUNK_SIZE);
  return Array.from({ length: listingChunks + 1 }, (_, id) => ({ id }));
}

export default async function sitemap({ id = 0 }: { id?: number } = {}): Promise<MetadataRoute.Sitemap> {
  if (id > 0) {
    const listings = await prisma.listing.findMany({
      where: publicListingWhere(),
      select: { id: true, title: true, updatedAt: true },
      orderBy: { id: "asc" },
      skip: (id - 1) * SITEMAP_CHUNK_SIZE,
      take: SITEMAP_CHUNK_SIZE,
    });

    return listings.map((l) => ({
      url: `${BASE_URL}${publicListingPath(l.id, l.title)}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/commission`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE_URL}/about`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/map`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.5 },
  ];

  const [sellers, blogPosts, openCommissions] = await Promise.all([
    prisma.sellerProfile.findMany({
      where: {
        chargesEnabled: true,
        vacationMode: false,
        user: { banned: false, deletedAt: null },
        listings: { some: publicListingWhere() },
      },
      select: { id: true, displayName: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: SITEMAP_ENTRY_LIMIT,
    }),
    prisma.blogPost.findMany({
      where: { status: "PUBLISHED", author: { banned: false, deletedAt: null } },
      select: { slug: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: SITEMAP_ENTRY_LIMIT,
    }),
    prisma.commissionRequest.findMany({
      where: openCommissionWhere(),
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: SITEMAP_ENTRY_LIMIT,
    }),
  ]);

  // ---------------------------------------------------------------------------
  // Metro city pages — only include metros with content
  // Major metros (no parent) get higher priority than child metros
  // ---------------------------------------------------------------------------
  const [metrosWithListings, metrosWithCommissions] = await Promise.all([
    prisma.metro.findMany({
      where: {
        isActive: true,
        OR: [
          { listings: { some: publicListingWhere() } },
          { listingCityMetros: { some: publicListingWhere() } },
          { sellerProfiles: { some: { chargesEnabled: true, vacationMode: false, user: { banned: false, deletedAt: null } } } },
          { sellerCityProfiles: { some: { chargesEnabled: true, vacationMode: false, user: { banned: false, deletedAt: null } } } },
        ],
      },
      select: { slug: true, updatedAt: true, parentMetroId: true },
    }),
    prisma.metro.findMany({
      where: {
        isActive: true,
        OR: [
          { commissions: { some: openCommissionWhere() } },
          { commissionCityMetros: { some: openCommissionWhere() } },
        ],
      },
      select: { slug: true, updatedAt: true, parentMetroId: true },
    }),
  ]);

  // Category pages: group active listings by metroId+category and cityMetroId+category
  // We need metro slugs — build a map from id → {slug, parentMetroId, updatedAt}
  const allMetros = await prisma.metro.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, parentMetroId: true, updatedAt: true },
  });
  const metroById = new Map(allMetros.map((m) => [m.id, m]));

  const [majorCatGroups, cityCatGroups] = await Promise.all([
    prisma.listing.groupBy({
      by: ["metroId", "category"],
      where: publicListingWhere({
        metroId: { not: null },
        category: { not: null },
      }),
      _max: { updatedAt: true },
      _count: { _all: true },
    }),
    prisma.listing.groupBy({
      by: ["cityMetroId", "category"],
      where: publicListingWhere({
        cityMetroId: { not: null },
        category: { not: null },
      }),
      _max: { updatedAt: true },
      _count: { _all: true },
    }),
  ]);

  // Build category route set (slug+category → most recent updatedAt)
  const categoryRouteMap = new Map<string, { updatedAt: Date; isMajor: boolean }>();
  for (const g of majorCatGroups) {
    if (!g.metroId || !g.category || !CATEGORY_VALUES.includes(g.category)) continue;
    const metro = metroById.get(g.metroId);
    if (!metro) continue;
    const key = `${metro.slug}/${g.category.toLowerCase()}`;
    const existing = categoryRouteMap.get(key);
    const updatedAt = g._max.updatedAt ?? metro.updatedAt;
    if (!existing || updatedAt > existing.updatedAt) {
      categoryRouteMap.set(key, { updatedAt, isMajor: !metro.parentMetroId });
    }
  }
  for (const g of cityCatGroups) {
    if (!g.cityMetroId || !g.category || !CATEGORY_VALUES.includes(g.category)) continue;
    const metro = metroById.get(g.cityMetroId);
    if (!metro) continue;
    const key = `${metro.slug}/${g.category.toLowerCase()}`;
    const existing = categoryRouteMap.get(key);
    const updatedAt = g._max.updatedAt ?? metro.updatedAt;
    if (!existing || updatedAt > existing.updatedAt) {
      categoryRouteMap.set(key, { updatedAt, isMajor: !metro.parentMetroId });
    }
  }

  // ---------------------------------------------------------------------------
  // Build route arrays
  // ---------------------------------------------------------------------------
  const sellerRoutes: MetadataRoute.Sitemap = sellers.flatMap((s) => [
    {
      url: `${BASE_URL}${publicSellerPath(s.id, s.displayName)}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    },
    {
      url: `${BASE_URL}${publicSellerShopPath(s.id, s.displayName)}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    },
  ]);

  const blogRoutes: MetadataRoute.Sitemap = blogPosts.map((p) => ({
    url: `${BASE_URL}/blog/${p.slug}`,
    lastModified: p.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const blogIndexRoute: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/blog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.8 },
  ];

  const commissionRoutes: MetadataRoute.Sitemap = openCommissions.map((c) => ({
    url: `${BASE_URL}/commission/${c.id}`,
    lastModified: c.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.5,
  }));

  // Metro browse + makers: major metro = 0.8/0.7, child metro = 0.6/0.5
  const metroRoutes: MetadataRoute.Sitemap = metrosWithListings.flatMap((m) => {
    const isMajor = !m.parentMetroId;
    return [
      {
        url: `${BASE_URL}/browse/${m.slug}`,
        lastModified: m.updatedAt,
        changeFrequency: "weekly" as const,
        priority: isMajor ? 0.8 : 0.6,
      },
      {
        url: `${BASE_URL}/makers/${m.slug}`,
        lastModified: m.updatedAt,
        changeFrequency: "monthly" as const,
        priority: isMajor ? 0.7 : 0.5,
      },
    ];
  });

  // Metro category pages
  const metroCategoryRoutes: MetadataRoute.Sitemap = Array.from(categoryRouteMap.entries()).map(
    ([key, { updatedAt, isMajor }]) => ({
      url: `${BASE_URL}/browse/${key}`,
      lastModified: updatedAt,
      changeFrequency: "weekly" as const,
      priority: isMajor ? 0.7 : 0.5,
    })
  );

  // City commission pages
  const metroCommissionRoutes: MetadataRoute.Sitemap = metrosWithCommissions.map((m) => ({
    url: `${BASE_URL}/commission/${m.slug}`,
    lastModified: m.updatedAt,
    changeFrequency: "weekly" as const,
    priority: !m.parentMetroId ? 0.7 : 0.5,
  }));

  return [
    ...staticRoutes,
    ...blogIndexRoute,
    ...sellerRoutes,
    ...blogRoutes,
    ...commissionRoutes,
    ...metroRoutes,
    ...metroCategoryRoutes,
    ...metroCommissionRoutes,
  ];
}
