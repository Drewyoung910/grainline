import { NextResponse } from "next/server";
import { getPopularListingTags } from "@/lib/popularTags";

// Cache popular tags for 1 hour via Next.js ISR
export const revalidate = 3600;

export async function GET() {
  return NextResponse.json({
    tags: await getPopularListingTags(8),
  });
}
