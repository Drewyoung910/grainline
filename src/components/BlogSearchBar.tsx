"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { BlogSuggestion } from "@/app/api/blog/search/suggestions/route";
import { Search } from "@/components/icons";

const FALLBACK_BLOG_TOPICS = ["woodworking", "behind the build", "care guide", "maker story"];

function blogPostPath(slug: string): string {
  return `/blog/${encodeURIComponent(slug)}`;
}

export default function BlogSearchBar({ initialQ }: { initialQ?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = React.useState(initialQ ?? "");
  const [suggestions, setSuggestions] = React.useState<BlogSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [popularTags, setPopularTags] = React.useState<string[]>([]);
  const [popularLoaded, setPopularLoaded] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/blog/search/suggestions?bq=${encodeURIComponent(v)}`);
        const data: { suggestions: BlogSuggestion[] } = await res.json();
        const suggs = data.suggestions ?? [];
        setSuggestions(suggs);
        setOpen(suggs.length > 0);
      } catch {
        setSuggestions([]);
        setOpen(false);
      }
    }, 300);
  }

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
    setOpen(false);
    navigate(value.trim());
  }

  function pick(s: BlogSuggestion) {
    setOpen(false);
    if (s.type === "post" && s.slug) {
      router.push(blogPostPath(s.slug));
    } else if (s.type === "tag" && s.tag) {
      const p = new URLSearchParams();
      if (searchParams.get("type")) p.set("type", searchParams.get("type")!);
      p.set("tags", s.tag);
      router.push(`/blog?${p}`);
    } else if (s.type === "author" && s.sellerProfileId) {
      const p = new URLSearchParams();
      if (searchParams.get("type")) p.set("type", searchParams.get("type")!);
      p.set("author", s.sellerProfileId);
      p.set("bq", s.label);
      router.push(`/blog?${p}`);
    } else {
      setValue(s.label);
      navigate(s.label);
    }
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit}>
        <div className="flex items-stretch rounded-full border border-neutral-200 bg-white overflow-hidden focus-within:ring-2 focus-within:ring-neutral-300">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none"
            width={16} height={16} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth={2} strokeLinecap="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <div className="relative flex-1">
            <input
              value={value}
              onChange={handleChange}
              onFocus={() => {
                if (value.length === 0) {
                  loadPopularTags();
                  setOpen(true);
                } else if (suggestions.length > 0) {
                  setOpen(true);
                }
              }}
              onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
              placeholder="Search posts, topics, makers..."
              className="w-full bg-transparent py-2 pl-10 pr-8 text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none"
              autoComplete="off"
            />
            {value && (
              <button
                type="button"
                onClick={() => { setValue(""); setSuggestions([]); setOpen(false); navigate(""); }}
                className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-base leading-none text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="submit"
            aria-label="Search"
            className="flex shrink-0 items-center justify-center rounded-none bg-neutral-900 px-4 text-white transition-colors hover:bg-neutral-800"
            style={{ borderRadius: 0 }}
          >
            <Search size={16} />
          </button>
        </div>
      </form>

      {(() => {
        const visiblePopularTags = popularTags.length > 0 ? popularTags : FALLBACK_BLOG_TOPICS;
        const showPopular = open && value.length === 0 && visiblePopularTags.length > 0;
        const showSuggestions = open && suggestions.length > 0;
        if (!showPopular && !showSuggestions) return null;
        return (
          <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
            {showPopular && (
              <>
                <li className="px-4 py-2 text-xs text-neutral-500 font-medium uppercase tracking-wide">
                  Popular topics
                </li>
                {visiblePopularTags.map((tag) => (
                  <li key={tag}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setOpen(false);
                        router.push(`/blog?bq=${encodeURIComponent(tag)}&sort=relevant`);
                      }}
                      className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-50 flex items-center gap-2"
                    >
                      <Search size={12} className="text-neutral-500" />
                      {tag}
                    </button>
                  </li>
                ))}
              </>
            )}
            {showSuggestions && suggestions.map((s, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-neutral-50"
                  onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                >
                  <span className="text-xs text-neutral-500 w-12 shrink-0">
                    {s.type === "post" ? "Post" : s.type === "tag" ? "Topic" : "Maker"}
                  </span>
                  <span className="text-neutral-800 truncate">
                    {s.type === "tag" ? `#${s.label}` : s.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        );
      })()}
    </div>
  );
}
