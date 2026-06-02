// src/app/sitemap.ts
import { prisma } from "@/lib/db";
import * as Sentry from "@sentry/nextjs";
import type { MetadataRoute } from "next";
import { BlogPostType } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { publicListingDetailWhere, publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { publicBlogAuthorPath, publicListingPath, publicSellerPath, publicSellerShopPath, publicTagPath } from "@/lib/publicPaths";
import { getPopularListingTags } from "@/lib/popularTags";
import { openCommissionWhere } from "@/lib/commissionExpiry";
import {
  SITEMAP_ENTRY_LIMIT,
  sitemapChunkCount,
  sitemapChunkForId,
} from "@/lib/sitemapIndex";
import { sitemapSourceCounts } from "@/lib/sitemapSourceCounts";

const BASE_URL = "https://thegrainline.com";
const STATIC_ROUTE_LAST_MODIFIED = new Date("2026-04-30T00:00:00.000Z");
const TAG_LANDING_SITEMAP_LIMIT = 100;
const BLOG_AUTHOR_LANDING_SITEMAP_LIMIT = 100;
const BLOG_AUTHOR_LANDING_SOURCE_LIMIT = 500;
const BLOG_TYPE_SITEMAP_FILTERS = [
  BlogPostType.GIFT_GUIDE,
  BlogPostType.MAKER_SPOTLIGHT,
  BlogPostType.BEHIND_THE_BUILD,
  BlogPostType.WOOD_EDUCATION,
] as const;

function assertSitemapEntryLimit(entries: MetadataRoute.Sitemap, source: string) {
  if (entries.length > SITEMAP_ENTRY_LIMIT) {
    Sentry.captureMessage("Sitemap entry limit exceeded", {
      level: "warning",
      tags: { source: "sitemap", sitemapSource: source },
      extra: { entryCount: entries.length, limit: SITEMAP_ENTRY_LIMIT },
    });
    throw new Error(`${source} sitemap has ${entries.length} entries, exceeding ${SITEMAP_ENTRY_LIMIT}`);
  }
  return entries;
}

export async function generateSitemaps() {
  const chunkCount = sitemapChunkCount(await sitemapSourceCounts());
  return Array.from({ length: chunkCount }, (_, id) => ({ id }));
}

export default async function sitemap({ id = 0 }: { id?: number } = {}): Promise<MetadataRoute.Sitemap> {
  if (id > 0) {
    const chunk = sitemapChunkForId(id, await sitemapSourceCounts());
    if (!chunk || chunk.kind === "base") return [];

    if (chunk.kind === "sellers") {
      const sellers = await prisma.sellerProfile.findMany({
        where: activeSellerProfileWhere({
          listings: { some: publicListingWhere() },
        }),
        select: { id: true, displayName: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: chunk.rowSkip,
        take: chunk.rowTake,
      });

      return sellers.flatMap((s) => [
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
    }

    if (chunk.kind === "customerPhotos") {
      const sellers = await prisma.sellerProfile.findMany({
        where: activeSellerProfileWhere({
          listings: {
            some: publicListingDetailWhere({
              reviews: { some: { photos: { some: {} } } },
            }),
          },
        }),
        select: { id: true, displayName: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: chunk.rowSkip,
        take: chunk.rowTake,
      });

      return sellers.map((s) => ({
        url: `${BASE_URL}${publicSellerPath(s.id, s.displayName)}/customer-photos`,
        lastModified: s.updatedAt,
        changeFrequency: "weekly",
        priority: 0.4,
      }));
    }

    if (chunk.kind === "blogPosts") {
      const blogPosts = await prisma.blogPost.findMany({
        where: publicBlogPostWhere(),
        select: { slug: true, updatedAt: true },
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        skip: chunk.rowSkip,
        take: chunk.rowTake,
      });

      return blogPosts.map((p) => ({
        url: `${BASE_URL}/blog/${p.slug}`,
        lastModified: p.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.7,
      }));
    }

    if (chunk.kind === "commissions") {
      const openCommissions = await prisma.commissionRequest.findMany({
        where: openCommissionWhere(),
        select: { id: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: chunk.rowSkip,
        take: chunk.rowTake,
      });

      return openCommissions.map((c) => ({
        url: `${BASE_URL}/commission/${c.id}`,
        lastModified: c.updatedAt,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      }));
    }

    const listings = await prisma.listing.findMany({
      where: publicListingWhere(),
      select: { id: true, title: true, updatedAt: true },
      orderBy: { id: "asc" },
      skip: chunk.rowSkip,
      take: chunk.rowTake,
    });

    return listings.map((l) => ({
      url: `${BASE_URL}${publicListingPath(l.id, l.title)}`,
      lastModified: l.updatedAt,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  }

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/browse`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "daily", priority: 0.9 },
    { url: `${BASE_URL}/commission`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "daily", priority: 0.7 },
    { url: `${BASE_URL}/about`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE_URL}/seller-handbook`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "weekly", priority: 0.7 },
    { url: `${BASE_URL}/why-grainline`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/why-sell-on-grainline`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${BASE_URL}/help/shipping-and-returns`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/help/trust-and-safety`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/become-a-maker`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE_URL}/terms`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/privacy`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/map`, lastModified: STATIC_ROUTE_LAST_MODIFIED, changeFrequency: "weekly", priority: 0.5 },
  ];

  const [latestBlogPost, latestBlogPostsByType, popularListingTagsForSitemap, blogAuthorSeedPosts] = await Promise.all([
    prisma.blogPost.findFirst({
      where: publicBlogPostWhere(),
      select: { updatedAt: true },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    }),
    Promise.all(BLOG_TYPE_SITEMAP_FILTERS.map((type) => prisma.blogPost.findFirst({
      where: publicBlogPostWhere({ type }),
      select: { type: true, updatedAt: true },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
    }))),
    getPopularListingTags(TAG_LANDING_SITEMAP_LIMIT),
    prisma.blogPost.findMany({
      where: publicBlogPostWhere({ sellerProfileId: { not: null } }),
      select: {
        sellerProfileId: true,
        updatedAt: true,
        sellerProfile: { select: { id: true, displayName: true } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: BLOG_AUTHOR_LANDING_SOURCE_LIMIT,
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
          { sellerProfiles: { some: activeSellerProfileWhere() } },
          { sellerCityProfiles: { some: activeSellerProfileWhere() } },
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

  const blogIndexRoute: MetadataRoute.Sitemap = [
    {
      url: `${BASE_URL}/blog`,
      lastModified: latestBlogPost?.updatedAt ?? STATIC_ROUTE_LAST_MODIFIED,
      changeFrequency: "daily",
      priority: 0.8,
    },
  ];
  const blogTypeRoutes: MetadataRoute.Sitemap = latestBlogPostsByType.flatMap((latestForType) => {
    if (!latestForType) return [];
    return [{
      url: `${BASE_URL}/blog?type=${encodeURIComponent(latestForType.type)}`,
      lastModified: latestForType.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }];
  });
  const tagLandingRoutes: MetadataRoute.Sitemap = popularListingTagsForSitemap.map((tag) => ({
    url: `${BASE_URL}${publicTagPath(tag)}`,
    lastModified: STATIC_ROUTE_LAST_MODIFIED,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
  const blogAuthorRouteMap = new Map<string, { displayName: string; updatedAt: Date }>();
  for (const post of blogAuthorSeedPosts) {
    if (!post.sellerProfileId || !post.sellerProfile) continue;
    if (blogAuthorRouteMap.has(post.sellerProfileId)) continue;
    blogAuthorRouteMap.set(post.sellerProfileId, {
      displayName: post.sellerProfile.displayName,
      updatedAt: post.updatedAt,
    });
    if (blogAuthorRouteMap.size >= BLOG_AUTHOR_LANDING_SITEMAP_LIMIT) break;
  }
  const blogAuthorLandingRoutes: MetadataRoute.Sitemap = Array.from(blogAuthorRouteMap.entries()).map(([id, author]) => ({
    url: `${BASE_URL}${publicBlogAuthorPath(id, author.displayName)}`,
    lastModified: author.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
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

  return assertSitemapEntryLimit([
    ...staticRoutes,
    ...blogIndexRoute,
    ...blogTypeRoutes,
    ...tagLandingRoutes,
    ...blogAuthorLandingRoutes,
    ...metroRoutes,
    ...metroCategoryRoutes,
    ...metroCommissionRoutes,
  ], "base");
}
