"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "@/components/icons";

type BlogResult = { slug: string; title: string };
type SuggestionsResponse = { suggestions: string[]; blogs?: BlogResult[] };

export default function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [open, setOpen] = React.useState(false);
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
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setValue(v);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (v.length < 2) {
      setSuggestions([]);
      setBlogs([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(v)}`);
        const data: SuggestionsResponse = await res.json();
        const suggs = data.suggestions ?? [];
        const blogResults = data.blogs ?? [];
        setSuggestions(suggs);
        setBlogs(blogResults);
        setOpen(suggs.length > 0 || blogResults.length > 0);
      } catch {
        setSuggestions([]);
        setBlogs([]);
        setOpen(false);
      }
    }, 300);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
      router.push(`/browse?q=${encodeURIComponent(value)}`);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setOpen(false);
    router.push(`/browse?q=${encodeURIComponent(value)}`);
  }

  function pick(s: string) {
    setValue(s);
    setOpen(false);
    router.push(`/browse?q=${encodeURIComponent(s)}`);
  }

  function pickBlog(slug: string) {
    setOpen(false);
    router.push(`/blog/${slug}`);
  }

  const hasItems = suggestions.length > 0 || blogs.length > 0;
  const showPopular = open && value.length === 0 && popularTags.length > 0;

  return (
    <div ref={containerRef} className="relative ml-auto mr-auto w-full max-w-lg">
      <form onSubmit={handleSubmit}>
        <div className="flex items-stretch rounded-full border bg-white overflow-hidden focus-within:ring-2 focus-within:ring-neutral-300">
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
            className="flex-1 pl-4 pr-2 py-2 bg-transparent text-neutral-900 placeholder:text-neutral-400 focus:outline-none"
            autoComplete="off"
          />
          <button
            type="submit"
            aria-label="Search"
            className="flex items-center justify-center px-4 bg-neutral-900 text-white hover:bg-neutral-800 transition-colors shrink-0"
          >
            <Search size={16} />
          </button>
        </div>
      </form>

      {(hasItems || showPopular) && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-white shadow-lg">
          {showPopular && (
            <>
              <li className="px-4 py-2 text-xs text-neutral-400 font-medium uppercase tracking-wide">
                Popular searches
              </li>
              {popularTags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setValue(tag);
                      setOpen(false);
                      router.push(`/browse?q=${encodeURIComponent(tag)}`);
                    }}
                    className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 flex items-center gap-2"
                  >
                    <Search size={12} className="text-neutral-400" />
                    {tag}
                  </button>
                </li>
              ))}
            </>
          )}
          {hasItems && (
            <>
              {suggestions.map((s) => (
                <li key={s}>
                  <button
                    type="button"
                    className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-50"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pick(s);
                    }}
                  >
                    {s}
                  </button>
                </li>
              ))}
              {blogs.length > 0 && (
                <>
                  {suggestions.length > 0 && <li className="border-t border-neutral-100" />}
                  {blogs.map((b) => (
                    <li key={b.slug}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm hover:bg-neutral-50"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          pickBlog(b.slug);
                        }}
                      >
                        <span className="text-xs text-amber-700 border border-amber-200 bg-amber-50 rounded px-1.5 py-0.5 shrink-0">
                          Story
                        </span>
                        <span className="truncate text-neutral-700">{b.title}</span>
                      </button>
                    </li>
                  ))}
                </>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  );
}
