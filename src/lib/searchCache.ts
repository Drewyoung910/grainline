import { revalidateTag } from "next/cache";

export const POPULAR_LISTING_TAGS_CACHE_TAG = "popular-listing-tags";
export const POPULAR_BLOG_TAGS_CACHE_TAG = "popular-blog-tags";
export const HOME_FEATURED_MAKER_CACHE_TAG = "home-featured-maker";

export function revalidateListingSearchCaches() {
  revalidateTag(POPULAR_LISTING_TAGS_CACHE_TAG, "max");
}

export function revalidateBlogSearchCaches() {
  revalidateTag(POPULAR_BLOG_TAGS_CACHE_TAG, "max");
}

export function revalidateFeaturedMakerCaches() {
  revalidateTag(HOME_FEATURED_MAKER_CACHE_TAG, "max");
}

export function revalidatePublicSellerVisibilityCaches() {
  revalidateListingSearchCaches();
  revalidateBlogSearchCaches();
  revalidateFeaturedMakerCaches();
}
