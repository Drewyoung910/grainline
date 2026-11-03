import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { publicListingWhere } from "@/lib/listingVisibility";
import { POPULAR_LISTING_TAGS_CACHE_TAG } from "@/lib/searchCache";

export { categoryCountLabel } from "./categoryCountLabel.ts";

// Public pieces per category for the homepage tiles. A global count, so it is
// shared across visitors; listing visibility changes refresh it through the
// same tag as the popular tags.
export const getCachedHomeCategoryCounts = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const rows = await prisma.listing.groupBy({
      by: ["category"],
      where: publicListingWhere(),
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const row of rows) {
      if (row.category) counts[row.category] = row._count._all;
    }
    return counts;
  },
  ["home-category-counts-v1"],
  { revalidate: 300, tags: [POPULAR_LISTING_TAGS_CACHE_TAG] },
);
