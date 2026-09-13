export type StripeWebhookHealthSummary = Readonly<{
  failedCount: number;
  releasedCount: number;
  staleCount: number;
  issueCount: number;
}>;

function boundedNonNegativeCount(value: unknown, label: string, maximum: number) {
  let parsed: bigint;
  if (typeof value === "bigint") {
    parsed = value;
  } else if (typeof value === "number" && Number.isSafeInteger(value)) {
    parsed = BigInt(value);
  } else if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    parsed = BigInt(value);
  } else {
    throw new Error(`${label} returned an invalid count`);
  }
  if (parsed < 0n || parsed > BigInt(maximum)) {
    throw new Error(`${label} returned an out-of-range count`);
  }
  return Number(parsed);
}

export function stripeWebhookPruneCountFromRows(
  rows: readonly Readonly<{ deleted_count: unknown }>[],
) {
  if (rows.length !== 1) {
    throw new Error("Stripe webhook prune returned an invalid row count");
  }
  return boundedNonNegativeCount(
    rows[0]?.deleted_count,
    "Stripe webhook prune",
    1000,
  );
}

export function stripeWebhookHealthSummaryFromRows(
  rows: readonly Readonly<{
    failed_count: unknown;
    released_count: unknown;
    stale_count: unknown;
    issue_count: unknown;
  }>[],
): StripeWebhookHealthSummary {
  if (rows.length !== 1) {
    throw new Error("Stripe webhook health summary returned an invalid row count");
  }
  const row = rows[0];
  const summary = Object.freeze({
    failedCount: boundedNonNegativeCount(
      row?.failed_count,
      "Stripe webhook failed summary",
      Number.MAX_SAFE_INTEGER,
    ),
    releasedCount: boundedNonNegativeCount(
      row?.released_count,
      "Stripe webhook released summary",
      Number.MAX_SAFE_INTEGER,
    ),
    staleCount: boundedNonNegativeCount(
      row?.stale_count,
      "Stripe webhook stale summary",
      Number.MAX_SAFE_INTEGER,
    ),
    issueCount: boundedNonNegativeCount(
      row?.issue_count,
      "Stripe webhook issue summary",
      Number.MAX_SAFE_INTEGER,
    ),
  });
  const failedCount = BigInt(summary.failedCount);
  const releasedCount = BigInt(summary.releasedCount);
  const staleCount = BigInt(summary.staleCount);
  const issueCount = BigInt(summary.issueCount);
  if (
    issueCount < failedCount
    || issueCount < releasedCount + staleCount
    || issueCount > failedCount + releasedCount + staleCount
  ) {
    throw new Error("Stripe webhook health summary returned inconsistent counts");
  }
  return summary;
}

export function legacyStockRestoreClaimFromRows(
  rows: readonly Readonly<{ claimed: unknown }>[],
) {
  if (rows.length !== 1 || typeof rows[0]?.claimed !== "boolean") {
    throw new Error("Checkout stock restore claim returned an invalid result");
  }
  return rows[0].claimed;
}
