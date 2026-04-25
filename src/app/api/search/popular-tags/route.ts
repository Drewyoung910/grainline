import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Cache popular tags for 1 hour via Next.js ISR
export const revalidate = 3600;

export async function GET() {
  const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*) as count
    FROM "Listing" l
    INNER JOIN "SellerProfile" sp ON sp.id = l."sellerId"
    INNER JOIN "User" u ON u.id = sp."userId",
         unnest(l.tags) AS tag
    WHERE l.status = 'ACTIVE'
      AND l."isPrivate" = false
      AND sp."chargesEnabled" = true
      AND sp."vacationMode" = false
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
