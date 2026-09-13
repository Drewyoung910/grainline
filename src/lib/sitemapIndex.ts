// src/lib/sitemapIndex.ts
// Helper for the /sitemap.xml index route. Kept Prisma-free so it can be unit
// tested. The chunk-count math must match `generateSitemaps()` in
// `src/app/sitemap.ts`: chunk id=0 holds static + metro/category routes, and
// every large dynamic source after that is chunked so no sitemap silently drops
// entries when the catalog grows.

export const SITEMAP_ENTRY_LIMIT = 50_000;
export const SITEMAP_CHUNK_SIZE = 5_000;
export const SITEMAP_SELLER_ROWS_PER_CHUNK = Math.floor(SITEMAP_ENTRY_LIMIT / 2);

export type SitemapSourceCounts = {
  listingCount: number;
  sellerCount: number;
  customerPhotoSellerCount: number;
  blogPostCount: number;
  commissionCount: number;
};

export type SitemapChunkKind =
  | "base"
  | "sellers"
  | "customerPhotos"
  | "blogPosts"
  | "commissions"
  | "listings";

export type SitemapChunk = {
  kind: SitemapChunkKind;
  index: number;
  rowSkip: number;
  rowTake: number;
};

function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function rowChunkCount(rowCount: number, rowsPerChunk: number): number {
  const count = safeCount(rowCount);
  if (count === 0) return 0;
  return Math.ceil(count / rowsPerChunk);
}

function normalizeCounts(input: number | SitemapSourceCounts): SitemapSourceCounts {
  if (typeof input === "number") {
    return {
      listingCount: input,
      sellerCount: 0,
      customerPhotoSellerCount: 0,
      blogPostCount: 0,
      commissionCount: 0,
    };
  }
  return input;
}

export function sitemapChunkCount(input: number | SitemapSourceCounts): number {
  const counts = normalizeCounts(input);
  return (
    1 +
    rowChunkCount(counts.sellerCount, SITEMAP_SELLER_ROWS_PER_CHUNK) +
    rowChunkCount(counts.customerPhotoSellerCount, SITEMAP_ENTRY_LIMIT) +
    rowChunkCount(counts.blogPostCount, SITEMAP_ENTRY_LIMIT) +
    rowChunkCount(counts.commissionCount, SITEMAP_ENTRY_LIMIT) +
    rowChunkCount(counts.listingCount, SITEMAP_CHUNK_SIZE)
  );
}

export function sitemapChunkForId(id: number, input: SitemapSourceCounts): SitemapChunk | null {
  if (!Number.isInteger(id) || id < 0) return null;
  if (id === 0) return { kind: "base", index: 0, rowSkip: 0, rowTake: SITEMAP_ENTRY_LIMIT };

  const sections: Array<{ kind: SitemapChunkKind; count: number; rowsPerChunk: number }> = [
    { kind: "sellers", count: input.sellerCount, rowsPerChunk: SITEMAP_SELLER_ROWS_PER_CHUNK },
    { kind: "customerPhotos", count: input.customerPhotoSellerCount, rowsPerChunk: SITEMAP_ENTRY_LIMIT },
    { kind: "blogPosts", count: input.blogPostCount, rowsPerChunk: SITEMAP_ENTRY_LIMIT },
    { kind: "commissions", count: input.commissionCount, rowsPerChunk: SITEMAP_ENTRY_LIMIT },
    { kind: "listings", count: input.listingCount, rowsPerChunk: SITEMAP_CHUNK_SIZE },
  ];

  let firstId = 1;
  for (const section of sections) {
    const chunks = rowChunkCount(section.count, section.rowsPerChunk);
    if (id < firstId + chunks) {
      const index = id - firstId;
      return {
        kind: section.kind,
        index,
        rowSkip: index * section.rowsPerChunk,
        rowTake: section.rowsPerChunk,
      };
    }
    firstId += chunks;
  }

  return null;
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
