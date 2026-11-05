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

export type CronRunPartialIssueRow = {
  id: string;
  jobName: string;
  bucket: string;
  startedAt: Date;
  result: unknown;
};

type CronRunQueryClient = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

// Completed runs since `since` whose result has a non-empty issue array or a
// positive issue count. Filtering in SQL keeps a frequent clean job (the
// email outbox runs 288 times a day) from pushing older partial failures out
// of the scan window.
export function recentCronRunsWithPartialIssues(
  client: CronRunQueryClient,
  since: Date,
  limit: number,
): Promise<CronRunPartialIssueRow[]> {
  return client.$queryRaw<CronRunPartialIssueRow[]>`
    SELECT "id", "jobName", "bucket", "startedAt", "result"
    FROM "CronRun"
    WHERE "status" = 'COMPLETED'
      AND "startedAt" >= ${since}
      AND "jobName" <> 'ops-health'
      AND CASE WHEN jsonb_typeof("result") = 'object' THEN EXISTS (
        SELECT 1 FROM jsonb_each("result") AS entry(key, value)
        WHERE (entry.key = ANY(${[...CRON_RUN_PARTIAL_ISSUE_KEYS]}::text[])
            AND jsonb_typeof(entry.value) = 'array' AND entry.value <> '[]'::jsonb)
          OR (entry.key = ANY(${[...CRON_RUN_PARTIAL_ISSUE_NUMERIC_KEYS]}::text[])
            AND jsonb_typeof(entry.value) = 'number' AND entry.value >= '1'::jsonb)
      ) ELSE false END
    ORDER BY "startedAt" DESC, "id" DESC
    LIMIT ${limit}
  `;
}
