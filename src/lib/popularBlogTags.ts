import { unstable_cache } from "next/cache";
import { POPULAR_BLOG_TAGS_CACHE_TAG } from "@/lib/searchCache";
import { sellerPublicBlogTags } from "@/lib/sellerProfilePublicAccess";

export type PopularBlogTag = {
  tag: string;
  count: number;
};

export const getPopularBlogTagRows = unstable_cache(
  async (limit = 8): Promise<PopularBlogTag[]> => {
    return (await sellerPublicBlogTags(limit)).map(({ tag, count }) => ({ tag, count }));
  },
  ["popular-blog-tag-rows"],
  { revalidate: 3600, tags: [POPULAR_BLOG_TAGS_CACHE_TAG] },
);

export async function getPopularBlogTags(limit = 8): Promise<string[]> {
  return (await getPopularBlogTagRows(limit)).map((r) => r.tag);
}
