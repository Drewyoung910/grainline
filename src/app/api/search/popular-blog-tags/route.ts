import { NextResponse } from "next/server";
import { getPopularBlogTags } from "@/lib/popularBlogTags";

// The underlying tag helper owns caching; keep this response uncached so
// revalidateTag("popular-blog-tags") is visible immediately.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    tags: await getPopularBlogTags(8),
  });
}
