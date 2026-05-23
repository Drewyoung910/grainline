import { NextResponse } from "next/server";
import { getPopularListingTags } from "@/lib/popularTags";

// The underlying tag helper owns caching; keep this response uncached so
// revalidateTag("popular-listing-tags") is visible immediately.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    tags: await getPopularListingTags(8),
  });
}
