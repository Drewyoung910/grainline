export type SellerDeauthorizationResult = Readonly<{
  outcome: "applied" | "replayed" | "absent";
  sellerProfileId: string | null;
  publicVisibilityChanged: boolean;
  affectedOrderCount: number;
}>;

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`seller deauthorization authority returned invalid ${field}`);
  }
  return value;
}

function nullableString(value: unknown, field: string) {
  return value === null ? null : requiredString(value, field);
}

function nonnegativeInteger(value: unknown, field: string) {
  const parsed = typeof value === "bigint" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TypeError(`seller deauthorization authority returned invalid ${field}`);
  }
  return parsed;
}

export function sellerDeauthorizationResultFromRows(
  rows: readonly Record<string, unknown>[],
): SellerDeauthorizationResult {
  const row = rows[0];
  if (rows.length !== 1 || !row) {
    throw new TypeError("seller deauthorization authority returned invalid cardinality");
  }
  if (row.outcome !== "applied" && row.outcome !== "replayed" && row.outcome !== "absent") {
    throw new TypeError("seller deauthorization authority returned invalid outcome");
  }
  if (typeof row.public_visibility_changed !== "boolean") {
    throw new TypeError("seller deauthorization authority returned invalid visibility state");
  }
  const sellerProfileId = nullableString(row.seller_profile_id, "seller id");
  const affectedOrderCount = nonnegativeInteger(row.affected_order_count, "affected-order count");
  if (
    (row.outcome === "absent" && (
      sellerProfileId !== null
      || row.public_visibility_changed
      || affectedOrderCount !== 0
    ))
    || (row.outcome !== "absent" && sellerProfileId === null)
  ) {
    throw new TypeError("seller deauthorization authority returned an inconsistent result");
  }
  return Object.freeze({
    outcome: row.outcome,
    sellerProfileId,
    publicVisibilityChanged: row.public_visibility_changed,
    affectedOrderCount,
  });
}
