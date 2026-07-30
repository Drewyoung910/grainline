export function validateActiveCaseResult(
  rows: Array<{ active: unknown }>,
  label: "buyer" | "seller",
) {
  if (rows.length !== 1) {
    throw new TypeError(
      `Case-aware ${label} Order authority returned an invalid row count`,
    );
  }
  const active = rows[0]?.active;
  if (active !== null && typeof active !== "boolean") {
    throw new TypeError(
      `Case-aware ${label} Order authority returned an invalid result`,
    );
  }
  return active;
}
