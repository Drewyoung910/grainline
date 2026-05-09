import { revalidateTag } from "next/cache";

export function revalidateListingSearchCaches() {
  revalidateTag("popular-listing-tags", "max");
}

export function revalidateBlogSearchCaches() {
  revalidateTag("popular-blog-tags", "max");
}
