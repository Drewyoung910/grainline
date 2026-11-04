export const BROWSE_SORT_OPTIONS = [
  { value: "relevant", label: "Most relevant", compactLabel: "Relevant", needsQuery: true },
  { value: "newest", label: "Newest", compactLabel: "Newest", needsQuery: false },
  { value: "price_asc", label: "Price: low to high", compactLabel: "Price ↑", needsQuery: false },
  { value: "price_desc", label: "Price: high to low", compactLabel: "Price ↓", needsQuery: false },
  { value: "popular", label: "Most popular", compactLabel: "Popular", needsQuery: false },
] as const;

export function visibleBrowseSortOptions(query: string, currentSort: string) {
  return BROWSE_SORT_OPTIONS.filter(
    (option) => !option.needsQuery || Boolean(query) || currentSort === option.value,
  );
}

export function browseSortLabel(query: string, currentSort: string, compact = false) {
  const option = visibleBrowseSortOptions(query, currentSort).find(
    (candidate) => candidate.value === currentSort,
  );
  if (!option) return "Newest";
  return compact ? option.compactLabel : option.label;
}
