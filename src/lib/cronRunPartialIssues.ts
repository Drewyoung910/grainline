export const CRON_RUN_PARTIAL_ISSUE_KEYS = ["failures", "errors"] as const;
export const CRON_RUN_PARTIAL_ISSUE_NUMERIC_KEYS = ["failed", "manualReview", "partialIssueCount"] as const;

export type CronRunPartialIssueSummary = {
  count: number;
  keys: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function cronRunPartialIssueSummary(result: unknown): CronRunPartialIssueSummary {
  if (!isRecord(result)) return { count: 0, keys: [] };

  let count = 0;
  const keys: string[] = [];

  for (const key of CRON_RUN_PARTIAL_ISSUE_KEYS) {
    const value = result[key];
    if (!Array.isArray(value) || value.length === 0) continue;
    count += value.length;
    keys.push(key);
  }
  for (const key of CRON_RUN_PARTIAL_ISSUE_NUMERIC_KEYS) {
    const value = result[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue;
    count += Math.trunc(value);
    keys.push(key);
  }

  return { count, keys };
}
