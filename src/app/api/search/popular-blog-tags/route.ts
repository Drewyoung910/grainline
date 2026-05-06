import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Cache for 1 hour
export const revalidate = 3600;

export async function GET() {
  const tags = await prisma.$queryRaw<Array<{ tag: string; count: bigint }>>`
    SELECT tag, COUNT(*) as count
    FROM "BlogPost" bp
    INNER JOIN "User" u ON u.id = bp."authorId"
    LEFT JOIN "SellerProfile" sp ON sp.id = bp."sellerProfileId"
    LEFT JOIN "User" seller_user ON seller_user.id = sp."userId",
         unnest(bp.tags) AS tag
    WHERE bp.status = 'PUBLISHED'
      AND u.banned = false
      AND u."deletedAt" IS NULL
      AND (
        bp."sellerProfileId" IS NULL
        OR (
          sp."chargesEnabled" = true
          AND sp."vacationMode" = false
          AND seller_user.banned = false
          AND seller_user."deletedAt" IS NULL
        )
      )
    GROUP BY tag
    ORDER BY count DESC
    LIMIT 8
  `;

  return NextResponse.json({
    tags: tags.map((r) => r.tag),
  });
}
