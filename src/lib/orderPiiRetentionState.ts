export const ORDER_BUYER_PII_RETENTION_DAYS = 90;

export function orderBuyerPiiRetentionCutoff({
  now = new Date(),
  retentionDays = ORDER_BUYER_PII_RETENTION_DAYS,
}: {
  now?: Date;
  retentionDays?: number;
} = {}) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
