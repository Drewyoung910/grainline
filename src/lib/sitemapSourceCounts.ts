import { prisma } from "@/lib/db";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { openCommissionWhere } from "@/lib/commissionExpiry";
import { publicListingDetailWhere, publicListingWhere } from "@/lib/listingVisibility";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import type { SitemapSourceCounts } from "@/lib/sitemapIndex";

export async function sitemapSourceCounts(): Promise<SitemapSourceCounts> {
  const [
    listingCount,
    sellerCount,
    customerPhotoSellerCount,
    blogPostCount,
    commissionCount,
  ] = await Promise.all([
    prisma.listing.count({ where: publicListingWhere() }),
    prisma.sellerProfile.count({
      where: activeSellerProfileWhere({
        listings: { some: publicListingWhere() },
      }),
    }),
    prisma.sellerProfile.count({
      where: activeSellerProfileWhere({
        listings: {
          some: publicListingDetailWhere({
            reviews: { some: { photos: { some: {} } } },
          }),
        },
      }),
    }),
    prisma.blogPost.count({ where: publicBlogPostWhere() }),
    prisma.commissionRequest.count({ where: openCommissionWhere() }),
  ]);

  return {
    listingCount,
    sellerCount,
    customerPhotoSellerCount,
    blogPostCount,
    commissionCount,
  };
}
