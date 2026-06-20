import { NextResponse } from "next/server";
import { getPopularBlogTags } from "@/lib/popularBlogTags";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit } from "@/lib/ratelimit";

// The underlying tag helper owns caching; keep this response uncached so
// revalidateTag("popular-blog-tags") is visible immediately.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { success, reset } = await safeRateLimit(searchRatelimit, getIP(req));
  if (!success) return rateLimitResponse(reset, "Too many popular-blog-topic requests.");

  return NextResponse.json({
    tags: await getPopularBlogTags(8),
  });
}
