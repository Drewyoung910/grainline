import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type RatingDbClient = typeof prisma | Prisma.TransactionClient;

export type SellerRating = { avg: number; count: number };

async function refreshSellerRatingSummaryInTransaction(
  sellerProfileId: string,
  db: Prisma.TransactionClient,
): Promise<SellerRating> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(913343, hashtext(${sellerProfileId}))`;

  const rows = await db.$queryRaw<Array<{ averageRating: number | null; reviewCount: bigint }>>`
    SELECT
      AVG(r."ratingX2")::float / 2.0 AS "averageRating",
      COUNT(r.id)::bigint AS "reviewCount"
    FROM "Review" r
    JOIN "Listing" l ON l.id = r."listingId"
    WHERE l."sellerId" = ${sellerProfileId}
  `;

  const reviewCount = Number(rows[0]?.reviewCount ?? 0);
  const averageRating = reviewCount > 0 ? Number(rows[0]?.averageRating ?? 0) : 0;

  await db.sellerRatingSummary.upsert({
    where: { sellerProfileId },
    create: { sellerProfileId, averageRating, reviewCount },
    update: { averageRating, reviewCount },
  });

  return { avg: averageRating, count: reviewCount };
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
