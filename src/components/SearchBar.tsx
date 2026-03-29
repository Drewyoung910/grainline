"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SearchBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [value, setValue] = React.useState(searchParams.get("q") ?? "");
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
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
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(v)}`);
        const data: { suggestions: string[] } = await res.json();
        const suggs = data.suggestions ?? [];
        setSuggestions(suggs);
        setOpen(suggs.length > 0);
      } catch {
        setSuggestions([]);
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

  return (
    <div ref={containerRef} className="relative ml-auto mr-auto w-full max-w-lg">
      <form onSubmit={handleSubmit}>
        <input
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Search handmade goods…"
          className="w-full rounded-full border px-4 py-2 bg-white text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          autoComplete="off"
        />
      </form>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-xl border bg-white shadow-lg">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className="w-full px-4 py-2 text-left text-sm hover:bg-neutral-50"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on input until navigation
                  pick(s);
                }}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
