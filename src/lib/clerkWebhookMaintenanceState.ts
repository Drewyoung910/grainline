export type ClerkWebhookHealthSummary = Readonly<{
  failedCount: number;
  releasedCount: number;
  staleCount: number;
  issueCount: number;
}>;

function nonNegativeCount(value: unknown, label: string, maximum: number) {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) parsed = BigInt(value);
  else throw new Error(`${label} returned an invalid count`);
  if (parsed < 0n || parsed > BigInt(maximum)) {
    throw new Error(`${label} returned an out-of-range count`);
  }
  return Number(parsed);
}

export function clerkWebhookPruneCountFromRows(
  rows: readonly Readonly<{ deleted_count: unknown }>[],
) {
  if (rows.length !== 1) {
    throw new Error("Clerk webhook prune returned an invalid row count");
  }
  return nonNegativeCount(rows[0]?.deleted_count, "Clerk webhook prune", 1000);
}

export function clerkWebhookHealthSummaryFromRows(
  rows: readonly Readonly<{
    failed_count: unknown;
    released_count: unknown;
    stale_count: unknown;
    issue_count: unknown;
  }>[],
): ClerkWebhookHealthSummary {
  if (rows.length !== 1) {
    throw new Error("Clerk webhook health summary returned an invalid row count");
  }
  const row = rows[0];
  const summary = Object.freeze({
    failedCount: nonNegativeCount(row?.failed_count, "Clerk webhook failed summary", Number.MAX_SAFE_INTEGER),
    releasedCount: nonNegativeCount(row?.released_count, "Clerk webhook released summary", Number.MAX_SAFE_INTEGER),
    staleCount: nonNegativeCount(row?.stale_count, "Clerk webhook stale summary", Number.MAX_SAFE_INTEGER),
    issueCount: nonNegativeCount(row?.issue_count, "Clerk webhook issue summary", Number.MAX_SAFE_INTEGER),
  });
  if (
    summary.issueCount < summary.failedCount
    || summary.issueCount < summary.releasedCount + summary.staleCount
    || summary.issueCount > summary.failedCount + summary.releasedCount + summary.staleCount
  ) {
    throw new Error("Clerk webhook health summary returned inconsistent counts");
  }
  return summary;
}
