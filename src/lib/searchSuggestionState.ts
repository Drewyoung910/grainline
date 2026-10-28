import { normalizeSearchQueryParameter } from "./searchQueryState.ts";

export const SEARCH_SUGGESTION_QUERY_MAX_CHARS = 80;
export const LISTING_FUZZY_SUGGESTION_MIN_SIMILARITY = 0.35;
export const BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY = 0.25;

export function normalizeSearchSuggestionQuery(raw: string | null | undefined) {
  const normalized = normalizeSearchQueryParameter(raw)
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(normalized)
    .slice(0, SEARCH_SUGGESTION_QUERY_MAX_CHARS)
    .join("");
}
