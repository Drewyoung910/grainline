"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import SearchParamsListener from "@/components/SearchParamsListener";
import { Clock, Edit, Grid, Package, Search, Sparkles, Store, Tag, X } from "@/components/icons";
import MediaImage from "@/components/MediaImage";
import { safeInternalPath } from "@/lib/internalReturnUrl";
import { LOCAL_ACCOUNT_STATE_CLEARED_EVENT } from "@/lib/localAccountState";
import { formatCurrencyCents } from "@/lib/money";
import {
  clearRecentSearches,
  loadRecentSearches,
  rememberRecentSearch,
} from "@/lib/recentSearches";
import {
  humanizeSearchTag,
  parseSearchSuggestionDetail,
  type SearchSuggestionItem,
  type SearchSuggestionItemType,
} from "@/lib/searchSuggestionResults";
import {
  popularSearchPresentation,
  searchSuggestionPhase,
} from "@/lib/searchSuggestionPresentation";
import {
  highlightParts,
  isSearchShortcut,
  parseSmartSearch,
  type SmartSearch,
} from "@/lib/smartSearch";

type BlogResult = {
  slug: string;
  title: string;
  coverImageUrl?: string | null;
  readingTimeMinutes?: number | null;
};
type CategoryResult = { value: string; label: string };
type SuggestionsResponse = {
  items?: unknown;
  blogs?: BlogResult[];
  categories?: CategoryResult[];
};
type SuggestionSection = "Pieces" | "Suggestions" | "Makers" | "Tags" | "Recently added";
type SearchOption =
  | { kind: "recent"; key: string; section: "Recent"; label: string }
  | { kind: "clearRecent"; key: string; section: "Recent"; label: string }
  | { kind: "smart"; key: string; section: "Search"; label: string; smart: SmartSearch }
  | { kind: "tag"; key: string; section: "Recommended searches"; label: string }
  | { kind: "category"; key: string; section: "Categories"; value: string; label: string }
  | { kind: "item"; key: string; section: SuggestionSection; item: SearchSuggestionItem; label: string }
  | {
      kind: "blog";
      key: string;
      section: "Stories";
      slug: string;
      label: string;
      coverImageUrl?: string | null;
      readingTimeMinutes?: number | null;
    }
  | { kind: "query"; key: string; section: "No matches" | "Search"; label: string };
const MAX_SEARCH_QUERY_LENGTH = 200;
const FALLBACK_POPULAR_SEARCHES = ["furniture", "kitchen", "decor", "gifts", "woodworking"];

function normalizeSearchQuery(query: string): string {
  return query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function browseSearchUrl(query: string): string {
  const normalized = normalizeSearchQuery(query);
  return normalized ? `/browse?q=${encodeURIComponent(normalized)}` : "/browse";
}

function browseCategoryUrl(category: string): string {
  const params = new URLSearchParams({ category });
  return `/browse?${params.toString()}`;
}

function blogPostPath(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

// Typed suggestions render grouped by section, in this order.
const ITEM_SECTIONS: Record<SearchSuggestionItemType, SuggestionSection> = {
  listing: "Pieces",
  search: "Suggestions",
  maker: "Makers",
  tag: "Tags",
};
const ITEM_SECTION_ORDER: SearchSuggestionItemType[] = ["listing", "search", "maker", "tag"];

function isSuggestionItem(value: unknown): value is SearchSuggestionItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.type === "string"
    && ITEM_SECTION_ORDER.includes(item.type as SearchSuggestionItemType)
    && typeof item.label === "string"
    && item.label.length > 0
    && typeof item.href === "string"
  );
}

function suggestionItems(value: unknown): SearchSuggestionItem[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isSuggestionItem).map((item) => {
    const detail = parseSearchSuggestionDetail(item.detail);
    return { type: item.type, label: item.label, href: item.href, ...(detail ? { detail } : {}) };
  });
}

// Bold the words the visitor typed. These are plain text nodes, never
// injected markup.
function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="bg-transparent font-semibold text-inherit">{part.text}</mark>
        ) : (
          <React.Fragment key={index}>{part.text}</React.Fragment>
        ),
      )}
    </>
  );
}

function SuggestionThumb({ src, fallback }: { src?: string | null; fallback: React.ReactNode }) {
  return (
    <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#EFEAE0] text-neutral-500">
      {fallback}
      {src && (
        <MediaImage
          src={src}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-10 object-cover"
          fallbackClassName="hidden"
        />
      )}
    </span>
  );
}

// "glass" sits on the homepage photo while the header is clear; "solid" is
// every other state. Either way the box turns solid white while focused, and
// the suggestions panel is always solid so it reads over any background.
export type SearchBarTone = "glass" | "solid";

// How long the suggestions keep their entrance stagger after the panel opens.
// Later result updates swap in place, so typing never replays the animation.
const SUGGESTION_STAGGER_MS = 520;
const SUGGESTION_DEBOUNCE_MS = 150;

type SearchRecommendations = Readonly<{
  tags: string[];
  pieces: SearchSuggestionItem[];
}>;

// The desktop header search is mounted even at phone widths, so let it warm
// the same recommendation request the mobile search will consume later. A
// module-level promise prevents duplicate requests and, importantly, does not
// paint fallback rows before replacing them with a different live set.
let searchRecommendationCache: SearchRecommendations | null = null;
let searchRecommendationRequest: Promise<SearchRecommendations> | null = null;
let searchRecommendationGeneration = 0;

function resetSharedSearchRecommendations() {
  searchRecommendationGeneration += 1;
  searchRecommendationCache = null;
  searchRecommendationRequest = null;
}

function loadSharedSearchRecommendations(): Promise<SearchRecommendations> {
  if (searchRecommendationCache !== null) return Promise.resolve(searchRecommendationCache);
  if (searchRecommendationRequest) return searchRecommendationRequest;

  const generation = searchRecommendationGeneration;
  const request = Promise.allSettled([
    fetch("/api/search/popular-tags").then(async (response) => {
      if (!response.ok) throw new Error(`Popular searches failed (${response.status})`);
      const data = await response.json() as { tags?: unknown };
      return Array.isArray(data.tags)
        ? data.tags.filter((tag: unknown): tag is string => typeof tag === "string" && tag.length > 0)
        : [];
    }),
    fetch("/api/search/suggestions?recent=1", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`Recent pieces failed (${response.status})`);
      const data = await response.json() as { recent?: unknown };
      return suggestionItems(data.recent);
    }),
  ])
    .then(([tags, pieces]) => {
      const recommendations = {
        tags: tags.status === "fulfilled" ? tags.value : [],
        pieces: pieces.status === "fulfilled" ? pieces.value : [],
      } satisfies SearchRecommendations;
      if (generation !== searchRecommendationGeneration) {
        return { tags: [], pieces: [] };
      }
      searchRecommendationCache = recommendations;
      return recommendations;
    })
    .finally(() => {
      if (searchRecommendationRequest === request) searchRecommendationRequest = null;
    });

  searchRecommendationRequest = request;
  return request;
}

function SearchOptionContent({ option, query }: { option: SearchOption; query: string }) {
  switch (option.kind) {
    case "smart":
      return (
        <>
          <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-neutral-500">
            <Sparkles size={14} className="text-[#2C1F1A]" />
            Smart search
          </span>
          <span className="flex flex-wrap gap-1.5">
            {option.smart.chips.map((chip) => (
              <span key={chip} className="rounded-full bg-[#2C1F1A] px-3 py-1 text-[13px] text-[#FBF8F3]">
                {chip}
              </span>
            ))}
          </span>
        </>
      );
    case "recent":
      return (
        <>
          <Clock size={14} className="shrink-0 text-neutral-500" />
          <span className="min-w-0 truncate">{option.label}</span>
        </>
      );
    case "clearRecent":
      return (
        <>
          <X size={14} className="shrink-0 text-neutral-400" />
          <span className="min-w-0 truncate text-sm text-neutral-500">{option.label}</span>
        </>
      );
    case "tag":
      return (
        <>
          <Search size={14} className="shrink-0 text-neutral-500" />
          <span className="min-w-0 truncate">{humanizeSearchTag(option.label)}</span>
        </>
      );
    case "query":
      return (
        <>
          <Search size={14} className="shrink-0 text-neutral-500" />
          <span className="min-w-0 truncate">{`Search for “${option.label}”`}</span>
        </>
      );
    case "category":
      return (
        <>
          <Grid size={14} className="shrink-0 text-neutral-500" />
          <span className="min-w-0 truncate"><HighlightedText text={option.label} query={query} /></span>
        </>
      );
    case "blog":
      return (
        <>
          <SuggestionThumb src={option.coverImageUrl} fallback={<Edit size={14} />} />
          <span className="min-w-0 flex-1">
            <span className="block truncate"><HighlightedText text={option.label} query={query} /></span>
            {option.readingTimeMinutes ? (
              <span className="block truncate text-[13px] text-neutral-500">{option.readingTimeMinutes} min read</span>
            ) : null}
          </span>
        </>
      );
    case "item": {
      const { item } = option;
      if (item.type === "listing" && item.detail) {
        const meta = [item.detail.makerName, item.detail.location].filter(Boolean).join(" · ");
        return (
          <>
            <SuggestionThumb src={item.detail.photoUrl} fallback={<Package size={14} />} />
            <span className="min-w-0 flex-1">
              <span className="block truncate"><HighlightedText text={option.label} query={query} /></span>
              {meta && <span className="block truncate text-[13px] text-neutral-500">{meta}</span>}
            </span>
            <span className="shrink-0 text-sm tabular-nums text-neutral-700">
              {formatCurrencyCents(item.detail.priceCents, item.detail.currency)}
            </span>
          </>
        );
      }
      return (
        <>
          {item.type === "listing" && <Package size={14} className="shrink-0 text-neutral-500" />}
          {item.type === "maker" && <Store size={14} className="shrink-0 text-neutral-500" />}
          {item.type === "tag" && <Tag size={14} className="shrink-0 text-neutral-500" />}
          {item.type === "search" && <Search size={14} className="shrink-0 text-neutral-500" />}
          <span className="min-w-0 truncate"><HighlightedText text={option.label} query={query} /></span>
        </>
      );
    }
  }
}

export default function SearchBar({
  autoFocus = false,
  tone = "solid",
}: {
  autoFocus?: boolean;
  tone?: SearchBarTone;
}) {
  const glass = tone === "glass";
  const router = useRouter();
  const pathname = usePathname();
  // Read through SearchParamsListener so the header around this search bar
  // still renders on the server (see that component). Empty until mounted.
  const [searchQuery, setSearchQuery] = React.useState("");
  const searchParams = React.useMemo(() => new URLSearchParams(searchQuery), [searchQuery]);
  const reactId = React.useId();
  const searchInputId = `${reactId}-site-search-input`;
  const searchListboxId = `${reactId}-site-search-listbox`;

  const [value, setValue] = React.useState(
    pathname === "/browse" ? (searchParams.get("q") ?? "") : "",
  );
  const [items, setItems] = React.useState<SearchSuggestionItem[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [categories, setCategories] = React.useState<CategoryResult[]>([]);
  // The query these remote results belong to. Keeping it separate from the
  // input prevents old categories/results from flashing while a newer query
  // is debouncing or in flight.
  const [resolvedQuery, setResolvedQuery] = React.useState<string | null>(null);
  // True when the latest suggestions request succeeded with no results, so
  // the dropdown can say so instead of silently closing.
  const [noMatches, setNoMatches] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
  const [recentSearches, setRecentSearches] = React.useState<string[]>([]);
  const [recentPieces, setRecentPieces] = React.useState<SearchSuggestionItem[]>([]);
  const popularLoadedRef = React.useRef(false);
  const popularLoadingRef = React.useRef(false);
  const popularLoadIdRef = React.useRef(0);
  const [closing, setClosing] = React.useState(false);
  // True only for the first moment after the panel opens, so the entrance
  // stagger plays once instead of on every keystroke.
  const [staggerItems, setStaggerItems] = React.useState(false);
  const staggerTimerRef = React.useRef<number | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = React.useRef<AbortController | null>(null);
  const suggestionsRequestRef = React.useRef(0);
  const closeTimerRef = React.useRef<number | null>(null);
  // Mirror of open/closing for stable callbacks registered with [] deps.
  const dropdownStateRef = React.useRef({ open: false, closing: false });
  dropdownStateRef.current = { open, closing };

  // Animated open/close matching the header popovers: close renders one
  // last frame with the -out animation, then unmounts after the timer.
  const openDropdown = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    const wasVisible = dropdownStateRef.current.open && !dropdownStateRef.current.closing;
    if (!wasVisible) {
      // Read on every open: another search box on the page may have added a
      // query, and storage is unavailable during the server render.
      setRecentSearches(loadRecentSearches());
      if (staggerTimerRef.current !== null) window.clearTimeout(staggerTimerRef.current);
      setStaggerItems(true);
      staggerTimerRef.current = window.setTimeout(() => {
        setStaggerItems(false);
        staggerTimerRef.current = null;
      }, SUGGESTION_STAGGER_MS);
    }
    setClosing(false);
    setOpen(true);
  }, []);

  const closeDropdown = React.useCallback(() => {
    const state = dropdownStateRef.current;
    if (!state.open || state.closing) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
      setActiveIndex(-1);
      closeTimerRef.current = null;
    }, 140);
  }, []);

  // Only the marketplace browse route owns the global search query. Other
  // pages also use `q` for local filters (for example the messages inbox),
  // and those route-local values must never populate the header search.
  React.useEffect(() => {
    setValue(pathname === "/browse" ? (searchParams.get("q") ?? "") : "");
  }, [pathname, searchParams]);

  const loadPopularTags = React.useCallback(async () => {
    if (popularLoadedRef.current || popularLoadingRef.current) return;
    const loadId = popularLoadIdRef.current + 1;
    popularLoadIdRef.current = loadId;
    popularLoadingRef.current = true;
    try {
      const recommendations = await loadSharedSearchRecommendations();
      if (loadId !== popularLoadIdRef.current) return;
      setPopularTags(recommendations.tags);
      setRecentPieces(recommendations.pieces);
    } finally {
      if (loadId !== popularLoadIdRef.current) return;
      popularLoadedRef.current = true;
      popularLoadingRef.current = false;
      setPopularLoaded(true);
    }
  }, []);

  // Warm the small recommendation request after hydration. The first click
  // should reveal one settled list, not wait for a click before starting the
  // request or paint a temporary category set that is immediately replaced.
  React.useEffect(() => {
    void loadPopularTags();
  }, [loadPopularTags]);

  // Mobile Safari does not reliably dispatch focus when an input is mounted
  // with autoFocus. Open the fallback recommendations independently so the
  // mobile search popup is useful even when the keyboard stays closed.
  React.useEffect(() => {
    if (autoFocus && value.length === 0) {
      void loadPopularTags();
      openDropdown();
    }
  }, [autoFocus, loadPopularTags, openDropdown, value.length]);

  // Dismiss on click outside
  React.useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [closeDropdown]);

  // "/" moves focus to the visible search box. Typing in a field and browser
  // shortcuts keep their native behavior, and an open modal owns the key.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isSearchShortcut(event)) return;
      const input = inputRef.current;
      if (!input || input.getClientRects().length === 0) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // Signing out or switching accounts must not leave this person's searches
  // or block-filtered recommendations on screen.
  React.useEffect(() => {
    function onCleared() {
      resetSharedSearchRecommendations();
      popularLoadIdRef.current += 1;
      popularLoadingRef.current = false;
      setRecentSearches([]);
      setRecentPieces([]);
      setPopularTags([]);
      popularLoadedRef.current = false;
      setPopularLoaded(false);
      void loadPopularTags();
    }
    window.addEventListener(LOCAL_ACCOUNT_STATE_CLEARED_EVENT, onCleared);
    return () => window.removeEventListener(LOCAL_ACCOUNT_STATE_CLEARED_EVENT, onCleared);
  }, [loadPopularTags]);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
      if (staggerTimerRef.current !== null) window.clearTimeout(staggerTimerRef.current);
      suggestionsAbortRef.current?.abort();
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.slice(0, MAX_SEARCH_QUERY_LENGTH);
    const q = normalizeSearchQuery(v);
    setValue(v);
    // Typing starts a fresh list, so a stale highlight can't be chosen by
    // Enter while new results load.
    setActiveIndex(-1);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestionsAbortRef.current?.abort();

    if (q.length < 2) {
      suggestionsRequestRef.current += 1;
      setResolvedQuery(null);
      setItems([]);
      setBlogs([]);
      setCategories([]);
      setNoMatches(false);
      setActiveIndex(-1);
      // Keep the panel open while typing the first letter: it narrows the
      // recommended searches locally instead of closing and reopening,
      // which made the dropdown flash between states.
      void loadPopularTags();
      openDropdown();
      return;
    }

    // Keep one stable "Search for" row while the matching remote results are
    // loading. Do not briefly substitute popular categories or stale results.
    setResolvedQuery(null);
    setNoMatches(false);

    debounceRef.current = setTimeout(async () => {
      const requestId = suggestionsRequestRef.current + 1;
      suggestionsRequestRef.current = requestId;
      const controller = new AbortController();
      suggestionsAbortRef.current = controller;
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        // A failed request (rate limit, server error) is not "no matches".
        if (!res.ok) throw new Error(`Search suggestions failed (${res.status})`);
        const data: SuggestionsResponse = await res.json();
        if (controller.signal.aborted || requestId !== suggestionsRequestRef.current) return;
        const itemResults = suggestionItems(data.items);
        const blogResults = data.blogs ?? [];
        const cats = data.categories ?? [];
        setItems(itemResults);
        setBlogs(blogResults);
        setCategories(cats);
        setNoMatches(itemResults.length === 0 && blogResults.length === 0 && cats.length === 0);
        setResolvedQuery(q);
        openDropdown();
        setActiveIndex(-1);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (requestId !== suggestionsRequestRef.current) return;
        // Fall back to the local "Search for" row instead of closing.
        setItems([]);
        setBlogs([]);
        setCategories([]);
        setNoMatches(false);
        setResolvedQuery(q);
        setActiveIndex(-1);
      } finally {
        if (suggestionsAbortRef.current === controller) {
          suggestionsAbortRef.current = null;
        }
      }
    }, SUGGESTION_DEBOUNCE_MS);
  }

  const hasItems = items.length > 0 || blogs.length > 0 || categories.length > 0;
  const visiblePopularTags = React.useMemo(
    () => popularSearchPresentation({
      loaded: popularLoaded,
      tags: popularTags,
      fallback: FALLBACK_POPULAR_SEARCHES,
    }),
    [popularLoaded, popularTags],
  );
  const query = normalizeSearchQuery(value);
  const smartSearch = React.useMemo(() => parseSmartSearch(query), [query]);
  const suggestionPhase = searchSuggestionPhase({ query, resolvedQuery, hasItems, noMatches });
  const waitingForResults = suggestionPhase === "waiting";
  const hasCurrentItems = suggestionPhase === "results";
  const options = React.useMemo<SearchOption[]>(() => {
    if (!open) return [];
    const prefix = query.toLowerCase();
    const recommended = (tags: string[]): SearchOption[] =>
      tags.map((tag) => ({
        kind: "tag",
        key: `tag:${tag}`,
        section: "Recommended searches",
        label: tag,
      }));
    if (query.length === 0) {
      const recents: SearchOption[] = recentSearches.length > 0
        ? [
            ...recentSearches.map((term) => ({
              kind: "recent" as const,
              key: `recent:${term}`,
              section: "Recent" as const,
              label: term,
            })),
            {
              kind: "clearRecent" as const,
              key: "clear-recent",
              section: "Recent" as const,
              label: "Clear recent searches",
            },
          ]
        : [];
      return [
        ...recents,
        ...recommended(visiblePopularTags),
        ...recentPieces.map((item) => ({
          kind: "item" as const,
          key: `recently-added:${item.href}`,
          section: "Recently added" as const,
          item,
          label: item.label,
        })),
      ];
    }
    // Keep the typed search first in every state so a response cannot move
    // the row under the pointer. Smart filters are an explicit second choice.
    const searchRows: SearchOption[] = [
      {
        kind: "query",
        key: "query",
        section: suggestionPhase === "empty" ? "No matches" : "Search",
        label: query,
      },
      ...(smartSearch
        ? [{
            kind: "smart" as const,
            key: "smart",
            section: "Search" as const,
            label: smartSearch.chips.join(", "),
            smart: smartSearch,
          }]
        : []),
    ];
    if (waitingForResults || suggestionPhase === "empty") return searchRows;
    if (!hasCurrentItems) {
      // First letter, or results still on their way: narrow the recommended
      // searches locally and offer the typed search, so the panel stays put.
      const matching = visiblePopularTags.filter((tag) =>
        humanizeSearchTag(tag).toLowerCase().includes(prefix),
      );
      return [...searchRows, ...recommended(matching.slice(0, 5))];
    }
    // Pieces and shops first, then categories, then stories.
    return [
      ...searchRows,
      ...ITEM_SECTION_ORDER.flatMap((type) =>
        items
          .filter((item) => item.type === type)
          .map((item) => ({
            kind: "item" as const,
            key: `${item.type}:${item.href}`,
            section: ITEM_SECTIONS[type],
            item,
            label: item.label,
          })),
      ),
      ...categories.map((cat) => ({
        kind: "category" as const,
        key: `category:${cat.value}`,
        section: "Categories" as const,
        value: cat.value,
        label: cat.label,
      })),
      ...blogs.map((blog) => ({
        kind: "blog" as const,
        key: `blog:${blog.slug}`,
        section: "Stories" as const,
        slug: blog.slug,
        label: blog.title,
        coverImageUrl: blog.coverImageUrl,
        readingTimeMinutes: blog.readingTimeMinutes,
      })),
    ];
  }, [blogs, categories, hasCurrentItems, items, open, query, recentPieces, recentSearches, smartSearch, suggestionPhase, visiblePopularTags, waitingForResults]);

  React.useEffect(() => {
    setActiveIndex((index) => {
      if (!open || options.length === 0) return -1;
      return index >= options.length ? options.length - 1 : index;
    });
  }, [open, options.length]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      closeDropdown();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        if (value.length === 0) void loadPopularTags();
        openDropdown();
      }
      setActiveIndex((index) => (options.length === 0 ? -1 : (index + 1) % options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openDropdown();
      setActiveIndex((index) => (options.length === 0 ? -1 : (index <= 0 ? options.length - 1 : index - 1)));
    } else if (e.key === "Home" && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End" && open && options.length > 0) {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const activeOption = activeIndex >= 0 ? options[activeIndex] : null;
      if (activeOption) {
        chooseOption(activeOption);
      } else {
        submitSearch(value);
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitSearch(value);
  }

  function submitSearch(term: string) {
    const normalized = normalizeSearchQuery(term);
    if (normalized) rememberRecentSearch(normalized);
    const smart = parseSmartSearch(normalized);
    closeDropdown();
    router.push(smart?.explicitFilter ? smart.href : browseSearchUrl(term));
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestionsAbortRef.current?.abort();
    suggestionsRequestRef.current += 1;
    setValue("");
    setItems([]);
    setBlogs([]);
    setCategories([]);
    setResolvedQuery(null);
    setNoMatches(false);
    setActiveIndex(-1);
    void loadPopularTags();
    openDropdown();
    inputRef.current?.focus();
    if (pathname === "/browse" && searchParams.has("q")) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("q");
      params.delete("page");
      const query = params.toString();
      router.push(query ? `/browse?${query}` : "/browse");
    }
  }

  function pickPlain(s: string) {
    setValue(s);
    const normalized = normalizeSearchQuery(s);
    if (normalized) rememberRecentSearch(normalized);
    closeDropdown();
    router.push(browseSearchUrl(s));
  }

  function chooseSmart(smart: SmartSearch) {
    if (query) rememberRecentSearch(query);
    closeDropdown();
    router.push(smart.href);
  }

  function pickBlog(slug: string) {
    closeDropdown();
    router.push(blogPostPath(slug));
  }

  function chooseOption(option: SearchOption) {
    switch (option.kind) {
      case "clearRecent":
        clearRecentSearches();
        setRecentSearches([]);
        setActiveIndex(-1);
        return;
      case "smart":
        chooseSmart(option.smart);
        return;
      case "recent":
        setValue(option.label);
        submitSearch(option.label);
        return;
      case "tag":
      case "query":
        pickPlain(option.label);
        return;
      case "item":
        if (option.item.type === "search") {
          pickPlain(option.item.label);
          return;
        }
        // Pieces, makers and tags open their own page.
        setValue("");
        closeDropdown();
        router.push(safeInternalPath(option.item.href, browseSearchUrl(option.item.label)));
        return;
      case "category":
        setValue("");
        closeDropdown();
        router.push(browseCategoryUrl(option.value));
        return;
      case "blog":
        pickBlog(option.slug);
        return;
    }
  }

  const activeOptionId = activeIndex >= 0 && options[activeIndex]
    ? `${searchListboxId}-${activeIndex}`
    : undefined;

  return (
    <div ref={containerRef} className="relative w-full min-w-0">
      <SearchParamsListener onChange={setSearchQuery} />
      <form onSubmit={handleSubmit} role="search">
        <label htmlFor={searchInputId} className="sr-only">
          Search Grainline
        </label>
        <div
          data-search-tone={tone}
          className={`flex min-h-[46px] items-stretch overflow-hidden rounded-full border transition-[background-color,border-color,box-shadow,color] duration-300 ease-[cubic-bezier(0.2,0.7,0.2,1)] focus-within:border-white focus-within:bg-white focus-within:text-neutral-900 focus-within:shadow-[0_14px_40px_-18px_rgba(0,0,0,0.45)] ${
            glass
              ? "border-white/35 bg-white/15 text-[#F5EFE6] backdrop-blur-md"
              : "border-[#2C1F1A]/[0.18] bg-white text-neutral-900"
          }`}
        >
          <button
            type="submit"
            aria-label="Search"
            className="group flex min-w-11 shrink-0 items-center justify-center rounded-full text-current opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-current/10 group-active:bg-current/15 group-focus-visible:ring-2 group-focus-visible:ring-current/30"
            >
              <Search size={18} />
            </span>
          </button>
          <input
            id={searchInputId}
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              void loadPopularTags();
              openDropdown();
            }}
            placeholder="Search pieces, shops, and more…"
            className="min-w-0 flex-1 bg-transparent py-2.5 pl-0 pr-2 text-[15px] text-current placeholder:text-current placeholder:opacity-70 focus:outline-none focus-visible:outline-none focus-visible:shadow-none"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            aria-keyshortcuts="/"
            role="combobox"
            aria-label="Search Grainline"
            aria-autocomplete="list"
            aria-expanded={open && !closing && options.length > 0}
            aria-controls={searchListboxId}
            aria-activedescendant={activeOptionId}
            autoFocus={autoFocus}
          />
          {value.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              // preventDefault keeps focus in the input so the popular panel
              // opens in place instead of blurring the field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              className="group flex min-w-11 items-center justify-center rounded-full text-current opacity-60 transition-opacity hover:opacity-100 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-current/10 group-active:bg-current/15 group-focus-visible:ring-2 group-focus-visible:ring-current/30"
              >
                <X size={15} />
              </span>
            </button>
          )}
        </div>
      </form>

      {options.length > 0 && (
        <ul
          id={searchListboxId}
          role="listbox"
          aria-busy={waitingForResults || undefined}
          // Scrollable, so browsers would make it a Tab stop; arrow keys on
          // the input drive it instead.
          tabIndex={-1}
          className={`scrollbar-hidden absolute left-0 right-0 top-full z-[60] mt-2 max-h-[min(28rem,calc(100dvh-9rem))] origin-top overflow-y-auto overscroll-contain rounded-2xl bg-white p-1.5 text-neutral-900 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] ring-1 ring-[#2C1F1A]/[0.12] motion-reduce:animate-none ${
            closing ? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"
          }`}
        >
          {options.map((option, index) => (
            <React.Fragment key={option.key}>
              {option.section !== "Search"
                && (index === 0 || options[index - 1].section !== option.section) && (
                <li
                  role="presentation"
                  className="px-3 pb-1.5 pt-2.5 text-[11px] font-medium uppercase tracking-[0.1em] text-neutral-500"
                >
                  {option.section}
                </li>
              )}
              <li
                id={`${searchListboxId}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
                className={staggerItems ? "search-option-in" : undefined}
                style={{ "--search-option-index": Math.min(index, 8) } as React.CSSProperties}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseOption(option);
                  }}
                  className={`min-h-11 w-full rounded-xl px-3.5 py-2.5 text-left text-[15px] transition-colors duration-150 hover:bg-[#F0EBE2]/70 ${
                    activeIndex === index ? "bg-[#F0EBE2]/70" : ""
                  } ${option.kind === "smart" ? "my-1 grid gap-2 bg-[#F7F5F0] hover:bg-[#F0EBE2]" : "flex items-center gap-3"}`}
                >
                  <SearchOptionContent option={option} query={query} />
                </button>
              </li>
            </React.Fragment>
          ))}
          {waitingForResults && (
            <li role="status" className="px-3 pb-2 pt-1 text-xs text-neutral-500">
              Finding matches…
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
