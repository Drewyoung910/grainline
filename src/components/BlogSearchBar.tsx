"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BlogSuggestion } from "@/app/api/blog/search/suggestions/route";
import { Search, X } from "@/components/icons";
import { publicBlogAuthorPath } from "@/lib/publicPaths";

const FALLBACK_BLOG_TOPICS = ["gift guides", "how to", "care guide", "maker story"];
const MAX_BLOG_SEARCH_QUERY_LENGTH = 200;
type BlogSearchOption =
  | { kind: "topic"; key: string; section: "Popular topics"; label: string }
  | { kind: "suggestion"; key: string; section: "Suggestions"; suggestion: BlogSuggestion; label: string };

function normalizeBlogSearchQuery(query: string): string {
  return query.trim().slice(0, MAX_BLOG_SEARCH_QUERY_LENGTH);
}

function blogPostPath(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

export default function BlogSearchBar({ initialQ }: { initialQ?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reactId = React.useId();
  const blogSearchListboxId = `${reactId}-blog-search-listbox`;
  const [value, setValue] = React.useState(initialQ ?? "");
  const [suggestions, setSuggestions] = React.useState<BlogSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsAbortRef = React.useRef<AbortController | null>(null);
  const suggestionsRequestRef = React.useRef(0);
  const closeTimerRef = React.useRef<number | null>(null);
  const dropdownStateRef = React.useRef({ open: false, closing: false });

  const openDropdown = React.useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dropdownStateRef.current = { open: true, closing: false };
    setClosing(false);
    setOpen(true);
  }, []);

  const closeDropdown = React.useCallback(() => {
    const state = dropdownStateRef.current;
    if (!state.open || state.closing) return;
    dropdownStateRef.current = { open: true, closing: true };
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      dropdownStateRef.current = { open: false, closing: false };
      setOpen(false);
      setClosing(false);
      setActiveIndex(-1);
      closeTimerRef.current = null;
    }, 140);
  }, []);

  // Sync on navigation
  React.useEffect(() => {
    setValue(searchParams.get("bq") ?? "");
  }, [searchParams]);

  async function loadPopularTags() {
    if (popularLoaded) return;
    try {
      const res = await fetch("/api/search/popular-blog-tags");
      const data = await res.json();
      setPopularTags(data.tags ?? []);
      setPopularLoaded(true);
    } catch {
      // fail silently
    }
  }

  // Click outside closes dropdown
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
    const v = e.target.value.slice(0, MAX_BLOG_SEARCH_QUERY_LENGTH);
    const q = normalizeBlogSearchQuery(v);
    setValue(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    suggestionsAbortRef.current?.abort();
    if (q.length < 2) {
      suggestionsRequestRef.current += 1;
      setSuggestions([]);
      closeDropdown();
      setActiveIndex(-1);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const requestId = suggestionsRequestRef.current + 1;
      suggestionsRequestRef.current = requestId;
      const controller = new AbortController();
      suggestionsAbortRef.current = controller;
      try {
        const res = await fetch(`/api/blog/search/suggestions?bq=${encodeURIComponent(q)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data: { suggestions: BlogSuggestion[] } = await res.json();
        if (controller.signal.aborted || requestId !== suggestionsRequestRef.current) return;
        const suggs = data.suggestions ?? [];
        setSuggestions(suggs);
        if (suggs.length > 0) {
          openDropdown();
        } else {
          closeDropdown();
        }
        setActiveIndex(-1);
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) return;
        if (requestId !== suggestionsRequestRef.current) return;
        setSuggestions([]);
        closeDropdown();
        setActiveIndex(-1);
      } finally {
        if (suggestionsAbortRef.current === controller) {
          suggestionsAbortRef.current = null;
        }
      }
    }, 300);
  }

  const visiblePopularTags = popularTags.length > 0 ? popularTags : FALLBACK_BLOG_TOPICS;
  const showPopular = open && value.length === 0 && visiblePopularTags.length > 0;
  const showSuggestions = open && suggestions.length > 0;
  const options = React.useMemo<BlogSearchOption[]>(() => {
    if (showPopular) {
      return visiblePopularTags.map((tag) => ({
        kind: "topic",
        key: `topic:${tag}`,
        section: "Popular topics",
        label: tag,
      }));
    }
    if (!showSuggestions) return [];
    return suggestions.map((suggestion, index) => ({
      kind: "suggestion",
      key: `${suggestion.type}:${suggestion.slug ?? suggestion.tag ?? suggestion.sellerProfileId ?? index}`,
      section: "Suggestions",
      suggestion,
      label: suggestion.label,
    }));
  }, [showPopular, showSuggestions, suggestions, visiblePopularTags]);
  const activeOptionId = activeIndex >= 0 && options[activeIndex]
    ? `${blogSearchListboxId}-${activeIndex}`
    : undefined;

  React.useEffect(() => {
    setActiveIndex((index) => {
      if (!open || options.length === 0) return -1;
      return index >= options.length ? options.length - 1 : index;
    });
  }, [open, options.length]);

  function navigate(q: string) {
    const p = new URLSearchParams();
    if (searchParams.get("type")) p.set("type", searchParams.get("type")!);
    if (q) {
      p.set("bq", q);
      p.set("sort", "relevant");
    }
    router.push(`/blog${p.toString() ? `?${p}` : ""}`);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    closeDropdown();
    navigate(value.trim());
  }

  function pick(s: BlogSuggestion) {
    closeDropdown();
    if (s.type === "post" && s.slug) {
      router.push(blogPostPath(s.slug));
    } else if (s.type === "tag" && s.tag) {
      const p = new URLSearchParams();
      if (searchParams.get("type")) p.set("type", searchParams.get("type")!);
      p.set("tags", s.tag);
      router.push(`/blog?${p}`);
    } else if (s.type === "author" && s.sellerProfileId) {
      router.push(publicBlogAuthorPath(s.sellerProfileId, s.label));
    } else {
      setValue(s.label);
      navigate(s.label);
    }
  }

  function pickTopic(tag: string) {
    closeDropdown();
    router.push(`/blog?bq=${encodeURIComponent(tag)}&sort=relevant`);
  }

  function chooseOption(option: BlogSearchOption) {
    if (option.kind === "topic") {
      pickTopic(option.label);
      return;
    }
    pick(option.suggestion);
  }

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
      const activeOption = activeIndex >= 0 ? options[activeIndex] : null;
      if (activeOption) {
        e.preventDefault();
        chooseOption(activeOption);
      }
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit} role="search">
        <label htmlFor={`${blogSearchListboxId}-input`} className="sr-only">
          Search blog posts
        </label>
        <div className="flex min-h-[46px] items-stretch overflow-hidden rounded-2xl border border-neutral-200 bg-white/90 shadow-sm transition-[border-color,box-shadow,background-color] focus-within:border-neutral-400 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-900/10">
          <button
            type="submit"
            aria-label="Search"
            className="group flex min-w-11 shrink-0 items-center justify-center rounded-full text-neutral-500 transition-colors hover:text-neutral-900 focus-visible:outline-none"
          >
            <span className="flex size-9 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/20">
              <Search size={18} />
            </span>
          </button>
          <div className="relative flex-1">
            <input
              id={`${blogSearchListboxId}-input`}
              value={value}
              onChange={handleChange}
              onFocus={() => {
                if (value.length === 0) {
                  loadPopularTags();
                  openDropdown();
                } else if (suggestions.length > 0) {
                  openDropdown();
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search posts, topics, makers..."
              className="h-full w-full bg-transparent py-2.5 pl-0 pr-2 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus-visible:outline-none focus-visible:shadow-none"
              autoComplete="off"
              maxLength={MAX_BLOG_SEARCH_QUERY_LENGTH}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open && !closing && options.length > 0}
              aria-controls={blogSearchListboxId}
              aria-activedescendant={activeOptionId}
            />
            {value && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setValue(""); setSuggestions([]); closeDropdown(); navigate(""); }}
                className="group absolute right-0 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-neutral-400 transition-colors hover:text-neutral-700 focus-visible:outline-none"
                aria-label="Clear search"
              >
                <span className="flex size-8 items-center justify-center rounded-full transition-colors group-hover:bg-neutral-100 group-active:bg-neutral-200/70 group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/20">
                  <X size={15} />
                </span>
              </button>
            )}
          </div>
        </div>
      </form>

      {options.length > 0 && (
        <ul
          id={blogSearchListboxId}
          role="listbox"
          className={`absolute left-0 right-0 top-full z-50 mt-2 max-h-[min(28rem,calc(100dvh-9rem))] overflow-y-auto overscroll-contain rounded-xl border border-stone-200/60 bg-white/95 text-neutral-900 shadow-lg backdrop-blur-lg motion-reduce:animate-none ${
            closing ? "animate-search-pop-out pointer-events-none" : "animate-search-pop-in"
          }`}
        >
          {options.map((option, index) => (
            <React.Fragment key={option.key}>
              {(index === 0 || options[index - 1].section !== option.section) && (
                <li role="presentation" className="px-4 py-2 text-xs text-neutral-500 font-medium uppercase tracking-wide">
                  {option.section}
                </li>
              )}
              <li
                id={`${blogSearchListboxId}-${index}`}
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
                  className={`w-full px-4 py-2 text-left text-sm transition-colors hover:bg-[#F7F5F0] ${
                    activeIndex === index ? "bg-[#EFEAE0]" : ""
                  } ${option.kind === "topic" ? "flex items-center gap-2" : "flex items-center gap-3 py-2.5"}`}
                >
                  {option.kind === "topic" ? (
                    <>
                      <Search size={12} className="text-neutral-500" />
                      {option.label}
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-neutral-500 w-12 shrink-0">
                        {option.suggestion.type === "post" ? "Post" : option.suggestion.type === "tag" ? "Topic" : "Maker"}
                      </span>
                      <span className="text-neutral-800 truncate">
                        {option.suggestion.type === "tag" ? `#${option.label}` : option.label}
                      </span>
                    </>
                  )}
                </button>
              </li>
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
