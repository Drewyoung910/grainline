export function isSimilarListingCategoryMatch(
  value: unknown,
): value is boolean | null {
  return value === null || typeof value === "boolean";
}

/**
 * PostgreSQL equality returns NULL when an optional candidate category is
 * absent. This is display-ranking data, so NULL means non-match; malformed
 * non-null values still fail the complete result boundary.
 */
export function normalizeSimilarListingCategoryMatch(
  value: boolean | null,
): boolean {
  return value === true;
}
