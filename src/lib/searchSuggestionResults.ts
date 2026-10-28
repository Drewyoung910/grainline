import { publicListingPath, publicSellerPath, publicTagPath } from "./publicPaths.ts";

// Typed header-search suggestions. `/api/search/suggestions` keeps its flat
// `suggestions: string[]` field for backward compatibility; SearchBar renders
// these typed items so each suggestion opens its own target instead of
// running a text search for every label.
export type SearchSuggestionItemType = "listing" | "search" | "maker" | "tag";

export type SearchSuggestionItem = {
  type: SearchSuggestionItemType;
  label: string;
  href: string;
};

type SuggestionListingTitle = { id?: string | null; title: string };
type SuggestionMaker = { id: string; displayName: string };

export const SEARCH_SUGGESTION_ITEM_LIMIT = 8;

// sellerPublicNameSuggestions() rejects input outside these bounds, measured
// in UTF-16 code units (`string.length`). normalizeDisplayNameForLookup()
// caps by code points and expands `&` to `&amp;`, so an emoji-heavy query
// (for example "(🪵&)" repeated) can exceed the normalized bound and make the
// lookup throw. Callers skip the seller lookup for such input instead.
const SELLER_NAME_SUGGESTION_QUERY_MAX_UNITS = 200;
const SELLER_NAME_SUGGESTION_NORMALIZED_MAX_UNITS = 100;

export function sellerNameSuggestionInputSupported(query: string, normalizedQuery: string): boolean {
  return (
    query.length >= 1
    && query.length <= SELLER_NAME_SUGGESTION_QUERY_MAX_UNITS
    && normalizedQuery.length <= SELLER_NAME_SUGGESTION_NORMALIZED_MAX_UNITS
  );
}

// Tags are stored hyphenated ("dj-table"); show them the way the
// "Recommended searches" panel does ("dj table").
export function humanizeSearchTag(raw: string): string {
  return raw.replace(/[-_]+/g, " ").trim();
}

function browseSearchPath(query: string): string {
  return `/browse?q=${encodeURIComponent(query)}`;
}

function listingTitleItem(row: SuggestionListingTitle): SearchSuggestionItem | null {
  const label = row.title.trim();
  if (!label) return null;
  // A listing id links straight to the piece; a bare title stays a search.
  return row.id
    ? { type: "listing", label, href: publicListingPath(row.id, label) }
    : { type: "search", label, href: browseSearchPath(label) };
}

export function buildSearchSuggestionItems(input: {
  listingTitles: readonly SuggestionListingTitle[];
  tags: readonly string[];
  makers: readonly SuggestionMaker[];
  fuzzyListingTitles: readonly SuggestionListingTitle[];
}): SearchSuggestionItem[] {
  const seen = new Set<string>();
  const items: SearchSuggestionItem[] = [];

  function add(item: SearchSuggestionItem | null) {
    if (!item) return;
    // Text searches dedupe case-insensitively by label; linked items dedupe
    // by destination, so a maker and a piece with the same name both stay.
    const key = item.type === "search" ? `search:${item.label.toLowerCase()}` : item.href;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  }

  for (const row of input.listingTitles) add(listingTitleItem(row));
  for (const tag of input.tags) {
    const label = humanizeSearchTag(tag);
    add(label ? { type: "tag", label, href: publicTagPath(tag) } : null);
  }
  for (const maker of input.makers) {
    const label = maker.displayName.trim();
    add(label ? { type: "maker", label, href: publicSellerPath(maker.id, label) } : null);
  }
  for (const row of input.fuzzyListingTitles) add(listingTitleItem(row));

  return items.slice(0, SEARCH_SUGGESTION_ITEM_LIMIT);
}
