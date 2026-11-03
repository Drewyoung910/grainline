import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type RatingDbClient = typeof prisma | Prisma.TransactionClient;

export type SellerRating = { avg: number; count: number };

async function refreshSellerRatingSummaryInTransaction(
  sellerProfileId: string,
  db: Prisma.TransactionClient,
): Promise<SellerRating> {
  const rows = await db.$queryRaw<Array<{ averageRating: number; reviewCount: number }>>`
    SELECT *
      FROM public.grainline_listing_seller_rating_summary_refresh(
        ${sellerProfileId}::text
      )
  `;
  if (
    rows.length !== 1
    || typeof rows[0]?.averageRating !== "number"
    || !Number.isFinite(rows[0].averageRating)
    || rows[0].averageRating < 0
    || rows[0].averageRating > 5
    || !Number.isSafeInteger(rows[0].reviewCount)
    || rows[0].reviewCount < 0
  ) {
    throw new Error("Seller rating summary refresh returned an invalid result");
  }

  return { avg: rows[0].averageRating, count: rows[0].reviewCount };
}

export async function refreshSellerRatingSummary(
  sellerProfileId: string,
  db: RatingDbClient = prisma,
): Promise<SellerRating> {
  if (db === prisma) {
    return prisma.$transaction((tx) => refreshSellerRatingSummaryInTransaction(sellerProfileId, tx));
  }
  return refreshSellerRatingSummaryInTransaction(sellerProfileId, db as Prisma.TransactionClient);
}

export async function getSellerRatingMap(sellerIds: string[]) {
  const ids = Array.from(new Set(sellerIds)).filter(Boolean);
  if (ids.length === 0) return new Map<string, SellerRating>();

  const rows = await prisma.sellerRatingSummary.findMany({
    where: {
      sellerProfileId: { in: ids },
      reviewCount: { gt: 0 },
    },
    select: {
      sellerProfileId: true,
      averageRating: true,
      reviewCount: true,
    },
  });

  const result = new Map<string, SellerRating>();
  for (const row of rows) {
    result.set(row.sellerProfileId, {
      avg: row.averageRating,
      count: row.reviewCount,
    });
  }
  return result;
}
