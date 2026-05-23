export type SellerMetricsResult = {
  sellerProfileId: string;
  calculatedAt: Date;
  periodMonths: number;
  averageRating: number;
  reviewCount: number;
  onTimeShippingRate: number;
  responseRate: number;
  totalSalesCents: number;
  completedOrderCount: number;
  activeCaseCount: number;
  accountAgeDays: number;
};

export const GUILD_MASTER_REQUIREMENTS = {
  averageRating: 4.5,
  reviewCount: 25,
  onTimeShippingRate: 0.95,
  responseRate: 0.90,
  accountAgeDays: 180,
  totalSalesCents: 100_000,
  activeCaseCount: 0,
};

export const METRICS_PERIOD_DAYS_PER_MONTH = 30;

export function metricsPeriodStart(now: Date, periodMonths: number) {
  const months = Math.max(0, Math.floor(periodMonths));
  return new Date(now.getTime() - months * METRICS_PERIOD_DAYS_PER_MONTH * 24 * 60 * 60 * 1000);
}

export function meetsGuildMasterRequirements(m: SellerMetricsResult): {
  ratingMet: boolean;
  reviewsMet: boolean;
  shippingMet: boolean;
  responseMet: boolean;
  ageMet: boolean;
  salesMet: boolean;
  casesMet: boolean;
  allMet: boolean;
} {
  const ratingMet = m.averageRating >= GUILD_MASTER_REQUIREMENTS.averageRating;
  const reviewsMet = m.reviewCount >= GUILD_MASTER_REQUIREMENTS.reviewCount;
  const shippingMet = m.onTimeShippingRate >= GUILD_MASTER_REQUIREMENTS.onTimeShippingRate;
  const responseMet = m.responseRate >= GUILD_MASTER_REQUIREMENTS.responseRate;
  const ageMet = m.accountAgeDays >= GUILD_MASTER_REQUIREMENTS.accountAgeDays;
  const salesMet = m.totalSalesCents >= GUILD_MASTER_REQUIREMENTS.totalSalesCents;
  const casesMet = m.activeCaseCount <= GUILD_MASTER_REQUIREMENTS.activeCaseCount;
  const allMet = ratingMet && reviewsMet && shippingMet && responseMet && ageMet && salesMet && casesMet;
  return { ratingMet, reviewsMet, shippingMet, responseMet, ageMet, salesMet, casesMet, allMet };
}
