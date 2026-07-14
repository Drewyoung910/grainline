"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "@/components/icons";

type BlogResult = { slug: string; title: string };
type CategoryResult = { value: string; label: string };
type SuggestionsResponse = { suggestions: string[]; blogs?: BlogResult[]; categories?: CategoryResult[] };
type SearchOption =
  | { kind: "tag"; key: string; section: "Popular searches"; label: string }
  | { kind: "category"; key: string; section: "Categories"; value: string; label: string }
  | { kind: "suggestion"; key: string; section: "Suggestions"; label: string }
  | { kind: "blog"; key: string; section: "Stories"; slug: string; label: string };
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

// Humanize a tag/slug for display only. Storage and search queries still use
// the raw value with dashes/underscores preserved.
function humanizeTag(raw: string): string {
  return raw.replace(/[-_]+/g, " ").trim();
}

export default function SearchBar({ variant = "default" }: { variant?: "default" | "glass" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const reactId = React.useId();
  const searchListboxId = `${reactId}-site-search-listbox`;

  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [categories, setCategories] = React.useState<CategoryResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
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

  // Sync input value when URL q param changes (back/forward nav)
  React.useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

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
      setSuggestions([]);
      setBlogs([]);
      setCategories([]);
      setActiveIndex(-1);
      if (v.length === 0) {
        // Field cleared while still focused — bring the popular-searches
        // panel back instead of leaving the dropdown dead until refocus.
        void loadPopularTags();
        openDropdown();
      } else {
        closeDropdown();
      }
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
        const data: SuggestionsResponse = await res.json();
        if (controller.signal.aborted || requestId !== suggestionsRequestRef.current) return;
        const suggs = data.suggestions ?? [];
        const blogResults = data.blogs ?? [];
        const cats = data.categories ?? [];
        setSuggestions(suggs);
        setBlogs(blogResults);
        setCategories(cats);
        if (suggs.length > 0 || blogResults.length > 0 || cats.length > 0) {
          openDropdown();
        } else {
          closeDropdown();
        }
        setActiveIndex(-1);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (requestId !== suggestionsRequestRef.current) return;
        setSuggestions([]);
        setBlogs([]);
        setCategories([]);
        closeDropdown();
        setActiveIndex(-1);
      } finally {
        if (suggestionsAbortRef.current === controller) {
          suggestionsAbortRef.current = null;
        }
      }
    }, 300);
  }

  const hasItems = suggestions.length > 0 || blogs.length > 0 || categories.length > 0;
  const visiblePopularTags = React.useMemo(
    () => (popularTags.length > 0 ? popularTags : FALLBACK_POPULAR_SEARCHES),
    [popularTags],
  );
  const showPopular = open && value.length === 0 && visiblePopularTags.length > 0;
  const options = React.useMemo<SearchOption[]>(() => {
    if (!open) return [];
    if (showPopular) {
      return visiblePopularTags.map((tag) => ({
        kind: "tag",
        key: `tag:${tag}`,
        section: "Popular searches",
        label: tag,
      }));
    }
    if (!hasItems) return [];
    return [
      ...categories.map((cat) => ({
        kind: "category" as const,
        key: `category:${cat.value}`,
        section: "Categories" as const,
        value: cat.value,
        label: cat.label,
      })),
      ...suggestions.map((suggestion) => ({
        kind: "suggestion" as const,
        key: `suggestion:${suggestion}`,
        section: "Suggestions" as const,
        label: suggestion,
      })),
      ...blogs.map((blog) => ({
        kind: "blog" as const,
        key: `blog:${blog.slug}`,
        section: "Stories" as const,
        slug: blog.slug,
        label: blog.title,
      })),
    ];
  }, [blogs, categories, hasItems, open, showPopular, suggestions, visiblePopularTags]);

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
    setSuggestions([]);
    setBlogs([]);
    setCategories([]);
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
      case "suggestion":
        pick(option.label);
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
    <div ref={containerRef} className="relative ml-auto mr-auto w-full min-w-0 max-w-lg">
      <form onSubmit={handleSubmit}>
        <div className={`flex items-stretch rounded-full border-2 overflow-hidden shadow-sm transition-shadow focus-within:shadow-md ${variant === "glass" ? "bg-white/15 backdrop-blur-sm border-white/40 focus-within:border-white/70" : "bg-white border-stone-400 focus-within:border-stone-600"}`}>
          <input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (value.length === 0) {
                loadPopularTags();
                openDropdown();
              } else if (hasItems) {
                openDropdown();
              }
            }}
            placeholder="Search handmade goods…"
            className={`min-w-0 flex-1 pl-4 pr-2 py-2 bg-transparent focus:outline-none focus-visible:outline-none focus-visible:shadow-none ${variant === "glass" ? "text-white placeholder:text-white/60" : "text-neutral-900 placeholder:text-neutral-500"}`}
            autoComplete="off"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && !closing && options.length > 0}
            aria-controls={searchListboxId}
            aria-activedescendant={activeOptionId}
          />
          {value.length > 0 && (
            <button
              type="button"
              aria-label="Clear search"
              // preventDefault keeps focus in the input so the popular panel
              // opens in place instead of blurring the field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleClear}
              className={`flex items-center px-2 transition-colors ${variant === "glass" ? "text-white/70 hover:text-white" : "text-neutral-400 hover:text-neutral-700"}`}
            >
              <X size={15} />
            </button>
          )}
          <button
            type="submit"
            aria-label="Search"
            style={{ borderRadius: 0 }}
            className={`flex items-center justify-center px-4 rounded-none transition-colors shrink-0 ${variant === "glass" ? "bg-white/20 text-white hover:bg-white/30" : "bg-neutral-900 text-white hover:bg-neutral-800"}`}
          >
            <Search size={16} />
          </button>
        </div>
      </form>

      {options.length > 0 && (
        <ul
          id={searchListboxId}
          role="listbox"
          className={`absolute left-0 right-0 top-full z-[60] mt-1 max-h-[min(28rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain rounded-xl border border-neutral-200 bg-white text-neutral-900 shadow-lg motion-reduce:animate-none ${closing ? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"}`}
        >
          {options.map((option, index) => (
            <React.Fragment key={option.key}>
              {(index === 0 || options[index - 1].section !== option.section) && (
                <li
                  role="presentation"
                  className={`px-4 py-2 text-xs font-medium uppercase tracking-wide text-neutral-500 ${
                    index > 0 ? "border-t border-neutral-100" : ""
                  }`}
                >
                  {option.section}
                </li>
              )}
              <li
                id={`${searchListboxId}-${index}`}
                role="option"
                aria-selected={activeIndex === index}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    chooseOption(option);
                  }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 ${
                    activeIndex === index ? "bg-neutral-100" : ""
                  } ${option.kind === "tag" || option.kind === "category" || option.kind === "blog" ? "flex items-center gap-2" : ""}`}
                >
                  {option.kind === "tag" && <Search size={12} className="text-neutral-500" />}
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
                    {option.kind === "tag" ? humanizeTag(option.label) : option.label}
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
