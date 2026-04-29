export const CRON_RUN_FAILED_RECLAIM_MS = 5 * 60 * 1000;

export function cronUtcHourBucket(date = new Date()) {
  return date.toISOString().slice(0, 13);
}

export function shouldReclaimFailedCronRun(
  existing: { status: string; startedAt: Date | null } | null | undefined,
  now = new Date(),
) {
  if (!existing || existing.status !== "FAILED") return false;
  if (!(existing.startedAt instanceof Date) || Number.isNaN(existing.startedAt.getTime())) return false;
  return existing.startedAt.getTime() < now.getTime() - CRON_RUN_FAILED_RECLAIM_MS;
}
