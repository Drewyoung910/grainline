export function isSimilarListingCategoryMatch(
  value: unknown,
): value is boolean | null {
  return value === null || typeof value === "boolean";
}

/**
 * PostgreSQL equality returns NULL when a candidate Listing has no category.
 * Category is optional display/ranking data, so treat that value as a
 * non-match instead of rejecting the complete public candidate result.
 */
export function normalizeSimilarListingCategoryMatch(
  value: boolean | null,
): boolean {
  return value === true;
}
