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
export const MAX_QUALITY_SCORE = 1.2;

function effectiveEngagementViews(views: number, clicks: number, orders: number) {
  if (views <= 0) return 0;
  const actionSupportedCap = DAMPENING_C + clicks * 25 + orders * 100;
  return Math.min(views, Math.max(DAMPENING_C, actionSupportedCap));
}

function favoriteSignal(favs: number, clicks: number, orders: number) {
  const base = Math.min(1, favs / 50);
  if (base <= 0) return 0;
  const engagementSupport = Math.min(1, (clicks + orders * 5) / Math.max(10, favs));
  return base * (0.4 + engagementSupport * 0.6);
}

function clampQualityScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.min(MAX_QUALITY_SCORE, Math.max(0, score));
}

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
  const engagementViews = effectiveEngagementViews(views, clicks, orders);

  const rawConversion = engagementViews > 0 ? orders / engagementViews : 0;
  const dampenedConversion =
    (engagementViews * rawConversion + DAMPENING_C * globals.avgConversion) /
    (engagementViews + DAMPENING_C);

  const rawCtr = engagementViews > 0 ? clicks / engagementViews : 0;
  const dampenedCtr =
    (engagementViews * rawCtr + DAMPENING_C * globals.avgCtr) / (engagementViews + DAMPENING_C);

  const rating = row.sellerAvgRating ?? globals.avgRating;
  const sellerRating = Math.min(1, Math.max(0, rating / 5));
  const favNorm = favoriteSignal(favs, clicks, orders);

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

  return clampQualityScore(score - penalty);
}
