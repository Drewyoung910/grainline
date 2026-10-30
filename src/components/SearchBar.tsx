"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Package, Search, Store, Tag, X } from "@/components/icons";
import { safeInternalPath } from "@/lib/internalReturnUrl";
import {
  humanizeSearchTag,
  type SearchSuggestionItem,
  type SearchSuggestionItemType,
} from "@/lib/searchSuggestionResults";

type BlogResult = { slug: string; title: string };
type CategoryResult = { value: string; label: string };
type SuggestionsResponse = {
  items?: unknown;
  blogs?: BlogResult[];
  categories?: CategoryResult[];
};
type SuggestionSection = "Pieces" | "Suggestions" | "Makers" | "Tags";
type SearchOption =
  | { kind: "tag"; key: string; section: "Recommended searches"; label: string }
  | { kind: "category"; key: string; section: "Categories"; value: string; label: string }
  | { kind: "item"; key: string; section: SuggestionSection; item: SearchSuggestionItem; label: string }
  | { kind: "blog"; key: string; section: "Stories"; slug: string; label: string }
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

// "glass" sits on the homepage photo while the header is clear; "solid" is
// every other state. Either way the box turns solid white while focused, and
// the suggestions panel is always solid so it reads over any background.
export type SearchBarTone = "glass" | "solid";

// How long the suggestions keep their entrance stagger after the panel opens.
// Later result updates swap in place, so typing never replays the animation.
const SUGGESTION_STAGGER_MS = 520;
const SUGGESTION_DEBOUNCE_MS = 150;

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
  const searchParams = useSearchParams();
  const reactId = React.useId();
  const searchInputId = `${reactId}-site-search-input`;
  const searchListboxId = `${reactId}-site-search-listbox`;

  const [value, setValue] = React.useState(
    pathname === "/browse" ? (searchParams.get("q") ?? "") : "",
  );
  const [items, setItems] = React.useState<SearchSuggestionItem[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [categories, setCategories] = React.useState<CategoryResult[]>([]);
  // True when the latest suggestions request succeeded with no results, so
  // the dropdown can say so instead of silently closing.
  const [noMatches, setNoMatches] = React.useState(false);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
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

  async function loadPopularTags() {
    if (popularLoaded) return;
    try {
      const res = await fetch("/api/search/popular-tags");
      const data = await res.json();
      setPopularTags(data.tags ?? []);
      setPopularLoaded(true);
    } catch {
      // fail silently
    }
  }

  // Mobile Safari does not reliably dispatch focus when an input is mounted
  // with autoFocus. Open the fallback recommendations independently so the
  // mobile search popup is useful even when the keyboard stays closed.
  React.useEffect(() => {
    if (autoFocus && value.length === 0) openDropdown();
  }, [autoFocus, openDropdown, value.length]);

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

    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestionsAbortRef.current?.abort();

    if (q.length < 2) {
      suggestionsRequestRef.current += 1;
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
        const itemResults = Array.isArray(data.items) ? data.items.filter(isSuggestionItem) : [];
        const blogResults = data.blogs ?? [];
        const cats = data.categories ?? [];
        setItems(itemResults);
        setBlogs(blogResults);
        setCategories(cats);
        setNoMatches(itemResults.length === 0 && blogResults.length === 0 && cats.length === 0);
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
    () => (popularTags.length > 0 ? popularTags : FALLBACK_POPULAR_SEARCHES),
    [popularTags],
  );
  const query = normalizeSearchQuery(value);
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
    if (query.length === 0) return recommended(visiblePopularTags);
    if (!hasItems) {
      if (noMatches && query.length >= 2) {
        return [{ kind: "query", key: "query", section: "No matches", label: query }];
      }
      // First letter, or results still on their way: narrow the recommended
      // searches locally and offer the typed search, so the panel stays put.
      const matching = visiblePopularTags.filter((tag) =>
        humanizeSearchTag(tag).toLowerCase().includes(prefix),
      );
      return [
        { kind: "query", key: "query", section: "Search", label: query },
        ...recommended(matching.slice(0, 5)),
      ];
    }
    // Pieces and shops first, then categories, then stories.
    return [
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
      })),
    ];
  }, [blogs, categories, hasItems, items, noMatches, open, query, visiblePopularTags]);

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
      closeDropdown();
      if (activeOption) {
        chooseOption(activeOption);
      } else {
        router.push(browseSearchUrl(value));
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closeDropdown();
    router.push(browseSearchUrl(value));
  }

  function handleClear() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestionsAbortRef.current?.abort();
    suggestionsRequestRef.current += 1;
    setValue("");
    setItems([]);
    setBlogs([]);
    setCategories([]);
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

  function pick(s: string) {
    setValue(s);
    closeDropdown();
    router.push(browseSearchUrl(s));
  }

  function pickBlog(slug: string) {
    closeDropdown();
    router.push(blogPostPath(slug));
  }

  function chooseOption(option: SearchOption) {
    switch (option.kind) {
      case "tag":
      case "query":
        pick(option.label);
        return;
      case "item":
        if (option.item.type === "search") {
          pick(option.item.label);
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
          className={`absolute left-0 right-0 top-full z-[60] mt-2 max-h-[min(28rem,calc(100dvh-9rem))] origin-top overflow-y-auto overscroll-contain rounded-2xl bg-white p-1.5 text-neutral-900 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)] ring-1 ring-[#2C1F1A]/[0.12] motion-reduce:animate-none ${
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
                  className={`w-full rounded-lg px-3 py-2 text-left text-[15px] transition-colors duration-150 hover:bg-[#F7F5F0] ${
                    activeIndex === index ? "bg-[#F7F5F0]" : ""
                  } ${option.kind === "item" && option.item.type === "search" ? "" : "flex items-center gap-2.5"}`}
                >
                  {(option.kind === "tag" || option.kind === "query") && (
                    <Search size={12} className="text-neutral-500" />
                  )}
                  {option.kind === "item" && option.item.type === "listing" && (
                    <Package size={14} className="shrink-0 text-neutral-500" />
                  )}
                  {option.kind === "item" && option.item.type === "maker" && (
                    <Store size={14} className="shrink-0 text-neutral-500" />
                  )}
                  {option.kind === "item" && option.item.type === "tag" && (
                    <Tag size={14} className="shrink-0 text-neutral-500" />
                  )}
                  {option.kind === "category" && (
                    <span className="text-xs text-neutral-500 border border-neutral-200 rounded px-1.5 py-0.5 shrink-0">
                      Category
                    </span>
                  )}
                  {option.kind === "blog" && (
                    <span className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5 shrink-0">
                      Story
                    </span>
                  )}
                  <span className={option.kind === "blog" ? "truncate text-neutral-700" : ""}>
                    {option.kind === "tag"
                      ? humanizeSearchTag(option.label)
                      : option.kind === "query"
                        ? `Search for “${option.label}”`
                        : option.label}
                  </span>
                </button>
              </li>
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
