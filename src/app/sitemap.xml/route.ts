// src/app/sitemap.xml/route.ts
// Sitemap index. The chunked sitemaps live at /sitemap/[id].xml via
// `generateSitemaps()` in `src/app/sitemap.ts`; Next.js does not auto-create an
// index. This route advertises every chunk so robots.txt can keep pointing at
// `/sitemap.xml` (the conventional path) and crawlers can discover all chunks.

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
