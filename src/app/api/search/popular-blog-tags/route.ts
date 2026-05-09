import { NextResponse } from "next/server";
import { getPopularBlogTags } from "@/lib/popularBlogTags";

// Cache for 1 hour
export const revalidate = 3600;

export async function GET() {
  return NextResponse.json({
    tags: await getPopularBlogTags(8),
  });
}
