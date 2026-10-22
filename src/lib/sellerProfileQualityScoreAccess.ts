import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ListingQualityScoreRow } from "@/lib/qualityScoreFormula";

type QualityScoreClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type QualityScoreBatchRow = Readonly<{
  id: unknown;
  sellerId: unknown;
  viewCount: unknown;
  clickCount: unknown;
  photoCount: unknown;
  hasAltText: unknown;
  descLength: unknown;
  aiReviewFlags: unknown;
  createdAt: unknown;
  sellerCreatedAt: unknown;
  guildLevel: unknown;
  sellerAvgRating: unknown;
  sellerReviewCount: unknown;
}>;

type QualityScoreZeroRow = Readonly<{ zeroedCount: unknown }>;

const ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;
const GUILD_LEVELS = new Set(["NONE", "GUILD_MEMBER", "GUILD_MASTER"]);

function nonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function nonnegativeBigInt(value: unknown): value is bigint {
  return typeof value === "bigint" && value >= 0n;
}

export async function sellerServiceQualityScoreBatch(
  afterListingId: string | null,
  limit = 200,
  client: QualityScoreClient = prisma,
): Promise<ListingQualityScoreRow[]> {
  if ((afterListingId !== null && !ID_PATTERN.test(afterListingId))
      || !Number.isInteger(limit)
      || limit < 1
      || limit > 200) {
    throw new RangeError("Seller quality-score batch input is outside the supported range");
  }
  const rows = await client.$queryRaw<QualityScoreBatchRow[]>`
    SELECT *
      FROM public.grainline_seller_service_quality_score_batch(
        ${afterListingId}, ${limit}
      )
  `;
  if (
    rows.length > limit
    || new Set(rows.map((row) => row.id)).size !== rows.length
    || rows.some((row) => (
      typeof row.id !== "string"
      || !ID_PATTERN.test(row.id)
      || typeof row.sellerId !== "string"
      || !ID_PATTERN.test(row.sellerId)
      || !nonnegativeInteger(row.viewCount)
      || !nonnegativeInteger(row.clickCount)
      || !nonnegativeBigInt(row.photoCount)
      || typeof row.hasAltText !== "boolean"
      || !nonnegativeInteger(row.descLength)
      || !Array.isArray(row.aiReviewFlags)
      || row.aiReviewFlags.length > 100
      || row.aiReviewFlags.some((flag) => typeof flag !== "string" || flag.length > 1000)
      || !(row.createdAt instanceof Date)
      || Number.isNaN(row.createdAt.getTime())
      || !(row.sellerCreatedAt instanceof Date)
      || Number.isNaN(row.sellerCreatedAt.getTime())
      || typeof row.guildLevel !== "string"
      || !GUILD_LEVELS.has(row.guildLevel)
      || !(row.sellerAvgRating === null
        || (typeof row.sellerAvgRating === "number"
          && Number.isFinite(row.sellerAvgRating)
          && row.sellerAvgRating >= 0
          && row.sellerAvgRating <= 5))
      || !nonnegativeBigInt(row.sellerReviewCount)
    ))
  ) {
    throw new Error("Seller quality-score batch authority returned an invalid result");
  }
  return rows as ListingQualityScoreRow[];
}

export async function sellerServiceZeroIneligibleQualityScores(
  client: QualityScoreClient = prisma,
) {
  const rows = await client.$queryRaw<QualityScoreZeroRow[]>`
    SELECT public.grainline_seller_service_quality_score_zero_ineligible()
      AS "zeroedCount"
  `;
  const value = rows.length === 1 ? rows[0]?.zeroedCount : null;
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Seller quality-score zeroing authority returned an invalid result");
  }
  return Number(value);
}
