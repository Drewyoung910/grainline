// src/app/sitemap.ts
import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";
import { ListingStatus, CommissionStatus } from "@prisma/client";

const BASE_URL = "https://thegrainline.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/commission`, lastModified: new Date(), changeFrequency: "daily", priority: 0.7 },
  ];

  const [listings, sellers, blogPosts, openCommissions] = await Promise.all([
    prisma.listing.findMany({
      where: { status: ListingStatus.ACTIVE },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    }),
    prisma.sellerProfile.findMany({
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 2000,
    }),
    prisma.blogPost.findMany({
      where: { status: "PUBLISHED" },
      select: { slug: true, publishedAt: true, updatedAt: true },
      orderBy: { publishedAt: "desc" },
      take: 2000,
    }),
    prisma.commissionRequest.findMany({
      where: { status: CommissionStatus.OPEN },
      select: { id: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: 500,
    }),
  ]);

  // Metro city pages — only include metros with content
  const metrosWithListings = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        { listings: { some: { status: ListingStatus.ACTIVE } } },
        { listingCityMetros: { some: { status: ListingStatus.ACTIVE } } },
        { sellerProfiles: { some: { chargesEnabled: true } } },
        { sellerCityProfiles: { some: { chargesEnabled: true } } },
      ],
    },
    select: { slug: true, updatedAt: true, parentMetroId: true },
  });

  const metrosWithCommissions = await prisma.metro.findMany({
    where: {
      isActive: true,
      OR: [
        { commissions: { some: { status: CommissionStatus.OPEN } } },
        { commissionCityMetros: { some: { status: CommissionStatus.OPEN } } },
      ],
    },
    select: { slug: true, updatedAt: true },
  });

  const metroSlugsWithCommissions = new Set(metrosWithCommissions.map((m) => m.slug));

  const listingRoutes: MetadataRoute.Sitemap = listings.map((l) => ({
    url: `${BASE_URL}/listing/${l.id}`,
    lastModified: l.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  const sellerRoutes: MetadataRoute.Sitemap = sellers.flatMap((s) => [
    {
      url: `${BASE_URL}/seller/${s.id}`,
      lastModified: s.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    },
    {
      url: `${BASE_URL}/seller/${s.id}/shop`,
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

  // City browse + makers pages
  const metroRoutes: MetadataRoute.Sitemap = metrosWithListings.flatMap((m) => [
    {
      url: `${BASE_URL}/browse/${m.slug}`,
      lastModified: m.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/makers/${m.slug}`,
      lastModified: m.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.6,
    },
  ]);

  // City commission pages (only metros with open commissions)
  const metroCommissionRoutes: MetadataRoute.Sitemap = metrosWithCommissions.map((m) => ({
    url: `${BASE_URL}/commission/${m.slug}`,
    lastModified: m.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  // De-duplicate commission metro routes (a metro might appear in both lists)
  const allCommissionMetroSlugs = new Set<string>();
  const dedupedMetroCommissionRoutes = metroCommissionRoutes.filter((r) => {
    const slug = r.url.split("/commission/")[1];
    if (allCommissionMetroSlugs.has(slug)) return false;
    allCommissionMetroSlugs.add(slug);
    return !metroSlugsWithCommissions.has(slug) || true; // always include, set is used for dedup
  });

  return [
    ...staticRoutes,
    ...blogIndexRoute,
    ...listingRoutes,
    ...sellerRoutes,
    ...blogRoutes,
    ...commissionRoutes,
    ...metroRoutes,
    ...dedupedMetroCommissionRoutes,
  ];
}
