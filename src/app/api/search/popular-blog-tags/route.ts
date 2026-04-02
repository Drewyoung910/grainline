import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Cache for 1 hour
export const revalidate = 3600;

export async function GET() {
  const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*) as count
    FROM "BlogPost",
         unnest(tags) AS tag
    WHERE status = 'PUBLISHED'
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 8
  `;

  return NextResponse.json({
    tags: tags.map((r) => r.tag),
  });
}
