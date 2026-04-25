import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Cache for 1 hour
export const revalidate = 3600;

export async function GET() {
  const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*) as count
    FROM "BlogPost" bp
    INNER JOIN "User" u ON u.id = bp."authorId",
         unnest(bp.tags) AS tag
    WHERE bp.status = 'PUBLISHED'
      AND u.banned = false
      AND u."deletedAt" IS NULL
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 8
  `;

  return NextResponse.json({
    tags: tags.map((r) => r.tag),
  });
}
