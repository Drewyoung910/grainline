// src/lib/sitemapIndex.ts
// Helper for the /sitemap.xml index route. Kept Prisma-free so it can be unit
// tested. The chunk-count math must match `generateSitemaps()` in
// `src/app/sitemap.ts`: chunk id=0 holds static + seller/blog/commission/metro
// routes, chunks id=1..N hold listing entries (SITEMAP_CHUNK_SIZE each).

export const SITEMAP_CHUNK_SIZE = 5_000;

export function sitemapChunkCount(listingCount: number): number {
  if (!Number.isFinite(listingCount) || listingCount < 0) return 1;
  const listingChunks = Math.ceil(listingCount / SITEMAP_CHUNK_SIZE);
  return listingChunks + 1;
}

export function sitemapIndexXml(baseUrl: string, chunkCount: number, lastmod: string): string {
  const entries: string[] = [];
  for (let i = 0; i < chunkCount; i++) {
    entries.push(`  <sitemap>
    <loc>${baseUrl}/sitemap/${i}.xml</loc>
    <lastmod>${lastmod}</lastmod>
  </sitemap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap-0.9">
${entries.join("\n")}
</sitemapindex>
`;
}
