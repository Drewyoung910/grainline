export type SearchSuggestionPhase = "recommendations" | "waiting" | "results" | "empty" | "fallback";

// Do not paint a temporary fallback list while the first live recommendation
// request is still resolving. That made the first focus visibly replace one
// complete set of suggestions with another; later focuses looked stable only
// because the request had already finished.
export function popularSearchPresentation({
  loaded,
  tags,
  fallback,
}: {
  loaded: boolean;
  tags: string[];
  fallback: string[];
}): string[] {
  if (!loaded) return [];
  return tags.length > 0 ? tags : fallback;
}

// Keep the header search in one stable presentation while a newer request is
// debouncing or in flight. Results may render only when they belong to the
// query currently visible in the input.
export function searchSuggestionPhase({
  query,
  resolvedQuery,
  hasItems,
  noMatches,
}: {
  query: string;
  resolvedQuery: string | null;
  hasItems: boolean;
  noMatches: boolean;
}): SearchSuggestionPhase {
  if (query.length === 0) return "recommendations";
  if (query.length >= 2 && resolvedQuery !== query) return "waiting";
  if (resolvedQuery === query && hasItems) return "results";
  if (resolvedQuery === query && noMatches && query.length >= 2) return "empty";
  return "fallback";
}
