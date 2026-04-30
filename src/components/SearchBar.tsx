"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "@/components/icons";

type BlogResult = { slug: string; title: string };
type CategoryResult = { value: string; label: string };
type SuggestionsResponse = { suggestions: string[]; blogs?: BlogResult[]; categories?: CategoryResult[] };
type SearchOption =
  | { kind: "tag"; key: string; section: "Popular searches"; label: string }
  | { kind: "category"; key: string; section: "Categories"; value: string; label: string }
  | { kind: "suggestion"; key: string; section: "Suggestions"; label: string }
  | { kind: "blog"; key: string; section: "Stories"; slug: string; label: string };
const MAX_SEARCH_QUERY_LENGTH = 200;
const SEARCH_LISTBOX_ID = "site-search-listbox";

function normalizeSearchQuery(query: string): string {
  return query.trim().slice(0, MAX_SEARCH_QUERY_LENGTH);
}

function browseSearchUrl(query: string): string {
  const normalized = normalizeSearchQuery(query);
  return normalized ? `/browse?q=${encodeURIComponent(normalized)}` : "/browse";
}

export default function SearchBar({ variant = "default" }: { variant?: "default" | "glass" }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [categories, setCategories] = React.useState<CategoryResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.slice(0, MAX_SEARCH_QUERY_LENGTH);
    const q = normalizeSearchQuery(v);
    setValue(v);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (q.length < 2) {
      setSuggestions([]);
      setBlogs([]);
      setCategories([]);
      setOpen(false);
      setActiveIndex(-1);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(q)}`);
        const data: SuggestionsResponse = await res.json();
        const suggs = data.suggestions ?? [];
        const blogResults = data.blogs ?? [];
        const cats = data.categories ?? [];
        setSuggestions(suggs);
        setBlogs(blogResults);
        setCategories(cats);
        setOpen(suggs.length > 0 || blogResults.length > 0 || cats.length > 0);
        setActiveIndex(-1);
      } catch {
        setSuggestions([]);
        setBlogs([]);
        setCategories([]);
        setOpen(false);
        setActiveIndex(-1);
      }
    }, 300);
  }

  const hasItems = suggestions.length > 0 || blogs.length > 0 || categories.length > 0;
  const showPopular = open && value.length === 0 && popularTags.length > 0;
  const options = React.useMemo<SearchOption[]>(() => {
    if (!open) return [];
    if (showPopular) {
      return popularTags.map((tag) => ({
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
  }, [blogs, categories, hasItems, open, popularTags, showPopular, suggestions]);

  React.useEffect(() => {
    setActiveIndex((index) => {
      if (!open || options.length === 0) return -1;
      return index >= options.length ? options.length - 1 : index;
    });
  }, [open, options.length]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        if (value.length === 0) void loadPopularTags();
        setOpen(true);
      }
      setActiveIndex((index) => (options.length === 0 ? -1 : (index + 1) % options.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) setOpen(true);
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
      setOpen(false);
      setActiveIndex(-1);
      if (activeOption) {
        chooseOption(activeOption);
      } else {
        router.push(browseSearchUrl(value));
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    setActiveIndex(-1);
    router.push(browseSearchUrl(value));
  }

  function pick(s: string) {
    setValue(s);
    setOpen(false);
    router.push(browseSearchUrl(s));
  }

  function pickBlog(slug: string) {
    setOpen(false);
    setActiveIndex(-1);
    router.push(`/blog/${slug}`);
  }

  function chooseOption(option: SearchOption) {
    switch (option.kind) {
      case "tag":
      case "suggestion":
        pick(option.label);
        return;
      case "category":
        setValue("");
        setOpen(false);
        setActiveIndex(-1);
        router.push(`/browse?category=${option.value}`);
        return;
      case "blog":
        pickBlog(option.slug);
        return;
    }
  }

  const activeOptionId = activeIndex >= 0 && options[activeIndex]
    ? `${SEARCH_LISTBOX_ID}-${activeIndex}`
    : undefined;

  return (
    <div ref={containerRef} className="relative ml-auto mr-auto w-full max-w-lg">
      <form onSubmit={handleSubmit}>
        <div className={`flex items-stretch rounded-full border overflow-hidden focus-within:ring-2 ${variant === "glass" ? "bg-white/15 backdrop-blur-sm border-white/40 focus-within:ring-white/30" : "bg-white border-neutral-200 focus-within:ring-neutral-300"}`}>
          <input
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              if (value.length === 0) {
                loadPopularTags();
                setOpen(true);
              } else if (hasItems) {
                setOpen(true);
              }
            }}
            placeholder="Search handmade goods…"
            className={`flex-1 pl-4 pr-2 py-2 bg-transparent focus:outline-none ${variant === "glass" ? "text-white placeholder:text-white/60" : "text-neutral-900 placeholder:text-neutral-500"}`}
            autoComplete="off"
            maxLength={MAX_SEARCH_QUERY_LENGTH}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && options.length > 0}
            aria-controls={SEARCH_LISTBOX_ID}
            aria-activedescendant={activeOptionId}
          />
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
          id={SEARCH_LISTBOX_ID}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-white shadow-lg"
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
                id={`${SEARCH_LISTBOX_ID}-${index}`}
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
                    {option.label}
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
