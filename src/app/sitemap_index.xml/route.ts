// src/app/sitemap_index.xml/route.ts
// Sitemap index. The chunked sitemaps live at /sitemap/[id].xml via
// `generateSitemaps()` in `src/app/sitemap.ts`; Next.js does not auto-create an
// index and reserves `/sitemap.xml` internally (a custom route there fails the
// build with "Conflicting route and metadata"). The index lives at
// `/sitemap_index.xml` and robots.txt advertises that URL — crawlers accept
// any URL listed in the `Sitemap:` directive.

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { sitemapChunkCount, sitemapIndexXml } from "@/lib/sitemapIndex";

const BASE_URL = "https://thegrainline.com";

export const revalidate = 3600;

export async function GET() {
  const listingCount = await prisma.listing.count({ where: publicListingWhere() });
  const chunkCount = sitemapChunkCount(listingCount);
  const lastmod = new Date().toISOString();
  const xml = sitemapIndexXml(BASE_URL, chunkCount, lastmod);

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
