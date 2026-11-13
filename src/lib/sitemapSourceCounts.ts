import { prisma } from "@/lib/db";
import { publicBlogPostWhere } from "@/lib/blogVisibility";
import { publicCommissionRequestCount } from "@/lib/commissionRequestAccess";
import { publicListingWhere } from "@/lib/listingVisibility";
import { sellerPublicSitemapCounts } from "@/lib/sellerProfilePublicAccess";
import type { SitemapSourceCounts } from "@/lib/sitemapIndex";

export async function sitemapSourceCounts(): Promise<SitemapSourceCounts> {
  const [
    listingCount,
    sellerCounts,
    blogPostCount,
    commissionCount,
  ] = await Promise.all([
    prisma.listing.count({ where: publicListingWhere() }),
    sellerPublicSitemapCounts(),
    prisma.blogPost.count({ where: publicBlogPostWhere() }),
    publicCommissionRequestCount(null),
  ]);

  return {
    listingCount,
    sellerCount: sellerCounts.sellerCount,
    customerPhotoSellerCount: sellerCounts.customerPhotoSellerCount,
    blogPostCount,
    commissionCount,
  };
}
