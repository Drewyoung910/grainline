export type CaseVerificationEligibilityResult = {
  agedUnresolvedCount: number;
};

export type CaseGuildUnresolvedGuardResult = {
  blocked: boolean;
};

function validateNonNegativeCount(value: unknown, label: string) {
  const count =
    typeof value === "bigint"
      ? Number(value)
      : typeof value === "number"
        ? value
        : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

export function validateCaseSellerActiveCount(rows: unknown[]) {
  if (rows.length !== 1) {
    throw new TypeError(
      "Case seller active-count authority returned an invalid row count",
    );
  }
  const row = rows[0] as { activeCount?: unknown };
  return validateNonNegativeCount(
    row?.activeCount,
    "Case seller active-count authority",
  );
}

export function validateCaseVerificationEligibility(
  rows: unknown[],
): CaseVerificationEligibilityResult | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case seller verification authority returned an invalid row count",
    );
  }
  const row = rows[0] as {
    agedUnresolvedCount?: unknown;
  };
  return {
    agedUnresolvedCount: validateNonNegativeCount(
      row?.agedUnresolvedCount,
      "Case seller verification authority",
    ),
  };
}

export function validateCaseGuildUnresolvedGuard(
  rows: unknown[],
): CaseGuildUnresolvedGuardResult | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case Guild unresolved guard returned an invalid row count",
    );
  }
  const row = rows[0] as { blocked?: unknown };
  if (typeof row?.blocked !== "boolean") {
    throw new TypeError("Case Guild unresolved guard returned an invalid result");
  }
  return {
    blocked: row.blocked,
  };
}
