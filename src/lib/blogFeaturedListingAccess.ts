import { ListingStatus } from "@prisma/client";

import { listingOwnerSummaryRows } from "@/lib/listingOwnerAccess";
import { listingPublicCatalogPage } from "@/lib/listingPublicCatalogAccess";

const LISTING_ID = /^[A-Za-z0-9._:-]{1,191}$/u;

export async function verifiedBlogFeaturedListingIds({
  actorUserId,
  isStaff,
  listingIds,
}: Readonly<{
  actorUserId: string;
  isStaff: boolean;
  listingIds: ReadonlyArray<string>;
}>) {
  const uniqueListingIds = [...new Set(listingIds)]
    .slice(0, 6)
    .filter((listingId) => LISTING_ID.test(listingId));
  if (uniqueListingIds.length === 0) return [];

  const allowedIds = new Set<string>();
  if (isStaff) {
    const page = await listingPublicCatalogPage(
      null,
      { listingIds: uniqueListingIds },
      0,
      uniqueListingIds.length,
    );
    for (const listing of page.listings) allowedIds.add(listing.id);
  } else {
    const listings = await listingOwnerSummaryRows(actorUserId, {
      status: ListingStatus.ACTIVE,
    });
    for (const listing of listings) allowedIds.add(listing.id);
  }

  return uniqueListingIds.filter((listingId) => allowedIds.has(listingId));
}
