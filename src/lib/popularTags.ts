import { unstable_cache } from "next/cache";
import {
  sellerPublicListingTags,
  sellerPublicSellerTags,
} from "@/lib/sellerProfilePublicAccess";

export const PUBLIC_SELLER_TOP_TAG_LIMIT = 8;

export const getPopularListingTags = unstable_cache(
  async (limit = 12): Promise<string[]> => {
    const rows = await sellerPublicListingTags(limit);
    return rows.map((row) => row.tag);
  },
  ["popular-listing-tags"],
  { revalidate: 3600, tags: ["popular-listing-tags"] },
);

export const getCachedPublicSellerTopTags = unstable_cache(
  async (sellerId: string): Promise<string[]> => {
    const rows = await sellerPublicSellerTags(sellerId, PUBLIC_SELLER_TOP_TAG_LIMIT);
    return rows.map((row) => row.tag);
  },
  ["public-seller-top-tags-v1"],
  { revalidate: 3600, tags: ["popular-listing-tags"] },
);
