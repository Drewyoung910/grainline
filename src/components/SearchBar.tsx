"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

type BlogResult = { slug: string; title: string };
type SuggestionsResponse = { suggestions: string[]; blogs?: BlogResult[] };

export default function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  const [blogs, setBlogs] = React.useState<BlogResult[]>([]);
  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync input value when URL q param changes (back/forward nav)
  React.useEffect(() => {
    setValue(searchParams.get("q") ?? "");
  }, [searchParams]);

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

    if (v.length < 3) {
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

  return (
    <div ref={containerRef} className="relative ml-auto mr-auto w-full max-w-lg">
      <form onSubmit={handleSubmit}>
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => hasItems && setOpen(true)}
          placeholder="Search handmade goods…"
          className="w-full rounded-full border px-4 py-2 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          autoComplete="off"
        />
      </form>

      {open && hasItems && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-white shadow-lg">
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
        </ul>
      )}
    </div>
  );
}
