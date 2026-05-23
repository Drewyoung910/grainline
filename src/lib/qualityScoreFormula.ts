import { qualityPenaltyForListing } from "./qualityScoreState.ts";

export interface ListingQualityScoreRow {
  id: string;
  sellerId: string;
  viewCount: number;
  clickCount: number;
  favCount: bigint;
  orderCount: bigint;
  photoCount: bigint;
  hasAltText: boolean;
  descLength: number;
  aiReviewFlags: string[];
  createdAt: Date;
  sellerCreatedAt: Date;
  guildLevel: string;
  sellerAvgRating: number | null;
  sellerReviewCount: bigint;
}

export interface QualityScoreGlobalMeans {
  avgConversion: number;
  avgCtr: number;
  avgRating: number;
}

const DAMPENING_C = 50;

export function scoreQualityRow(
  row: ListingQualityScoreRow,
  globals: QualityScoreGlobalMeans,
  now: number,
): number {
  const views = row.viewCount ?? 0;
  const clicks = row.clickCount ?? 0;
  const orders = Number(row.orderCount);
  const favs = Number(row.favCount);
  const photos = Number(row.photoCount);

  const rawConversion = views > 0 ? orders / views : 0;
  const dampenedConversion =
    (views * rawConversion + DAMPENING_C * globals.avgConversion) /
    (views + DAMPENING_C);

  const rawCtr = views > 0 ? clicks / views : 0;
  const dampenedCtr =
    (views * rawCtr + DAMPENING_C * globals.avgCtr) / (views + DAMPENING_C);

  const rating = row.sellerAvgRating ?? globals.avgRating;
  const sellerRating = Math.min(1, Math.max(0, rating / 5));
  const favNorm = Math.min(1, favs / 50);

  const ageMs = now - new Date(row.createdAt).getTime();
  const ageInDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));
  const recency = 1.0 / (1.0 + ageInDays / 60.0);

  const guildBonus =
    row.guildLevel === "GUILD_MASTER"
      ? 1.0
      : row.guildLevel === "GUILD_MEMBER"
        ? 0.6
        : 0;

  const photoScore = Math.min(1.0, photos / 4) * (row.hasAltText ? 1.0 : 0.8);
  const descScore = Math.min(1.0, (row.descLength ?? 0) / 200);

  const newListingBump =
    ageInDays <= 14
      ? 0.15
      : ageInDays <= 30
        ? 0.15 * (1.0 - (ageInDays - 14) / 16)
        : 0;

  const sellerReviews = Number(row.sellerReviewCount ?? 0);
  const sellerAgeDays = Math.max(
    0,
    (now - new Date(row.sellerCreatedAt).getTime()) / (1000 * 60 * 60 * 24),
  );
  const newSellerBonus = sellerReviews === 0 && sellerAgeDays <= 30 ? 0.05 : 0;

  const score =
    dampenedConversion * 0.25 +
    sellerRating * 0.2 +
    favNorm * 0.15 +
    recency * 0.15 +
    dampenedCtr * 0.1 +
    guildBonus * 0.05 +
    photoScore * 0.05 +
    descScore * 0.05 +
    newListingBump +
    newSellerBonus;

  const penalty = qualityPenaltyForListing({
    descLength: row.descLength,
    photoCount: photos,
    aiReviewFlags: row.aiReviewFlags,
  });

  return Math.max(0, score - penalty);
}
