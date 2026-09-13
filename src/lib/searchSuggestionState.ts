export const SEARCH_SUGGESTION_QUERY_MAX_CHARS = 80;
export const LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY = 0.35;
export const BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY = 0.25;

export function normalizeSearchSuggestionQuery(raw: string | null | undefined) {
  return (raw ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_SUGGESTION_QUERY_MAX_CHARS);
}
