export const SELLER_METRICS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isSellerMetricsFresh(
  metrics: { calculatedAt: Date | string | number },
  now = new Date(),
  maxAgeMs = SELLER_METRICS_MAX_AGE_MS,
) {
  const calculatedAtMs = new Date(metrics.calculatedAt).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(calculatedAtMs)) return false;
  if (calculatedAtMs - nowMs > 5 * 60 * 1000) return false;
  return nowMs - calculatedAtMs <= maxAgeMs;
}
