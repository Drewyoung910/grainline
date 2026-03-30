// src/app/sitemap.ts
import { prisma } from "@/lib/db";
import type { MetadataRoute } from "next";
import { ListingStatus } from "@prisma/client";

const BASE_URL = "https://grainline.co";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${BASE_URL}/`, lastModified: new Date(), changeFrequency: "daily", priority: 1.0 },
    { url: `${BASE_URL}/browse`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
  ];

  const [listings, sellers, blogPosts] = await Promise.all([
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
  ]);

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

  return [...staticRoutes, ...blogIndexRoute, ...listingRoutes, ...sellerRoutes, ...blogRoutes];
}
