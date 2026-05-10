"use client";

import { useEffect, useRef, useState } from "react";
import {
  placeToAddress,
  type AddressAutocompleteResult,
  type NominatimPlace,
} from "@/lib/addressAutocompleteState";

export default function AddressAutocomplete({
  id,
  label = "Find address",
  placeholder = "Search address",
  onSelect,
  className = "",
  inputClassName = "",
}: {
  id?: string;
  label?: string;
  placeholder?: string;
  onSelect: (address: AddressAutocompleteResult) => void;
  className?: string;
  inputClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AddressAutocompleteResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          format: "jsonv2",
          addressdetails: "1",
          countrycodes: "us",
          limit: "5",
          q: trimmed,
        });
        const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as NominatimPlace[];
        setResults(Array.isArray(data) ? data.map(placeToAddress).filter((item) => item.label) : []);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-sm font-medium text-neutral-700">
          {label}
        </label>
      )}
      <input
        id={id}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(results.length > 0)}
        placeholder={placeholder}
        autoComplete="off"
        className={
          inputClassName ||
          "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        }
      />
      {open && (results.length > 0 || loading) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-500">Searching...</div>
          ) : (
            results.map((result) => (
              <button
                key={`${result.label}:${result.lat}:${result.lng}`}
                type="button"
                className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery("");
                  setOpen(false);
                  onSelect(result);
                }}
              >
                {result.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
