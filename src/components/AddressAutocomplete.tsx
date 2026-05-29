"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const [searched, setSearched] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const generatedId = useId();
  const abortRef = useRef<AbortController | null>(null);
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-listbox`;

  function selectResult(result: AddressAutocompleteResult) {
    setQuery("");
    setOpen(false);
    onSelect(result);
  }

  useEffect(() => {
    const trimmed = query.trim();
    abortRef.current?.abort();

    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setActiveIndex(0);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setResults([]);
    setSearched(false);
    setLoading(true);
    setOpen(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/address/autocomplete?q=${encodeURIComponent(trimmed)}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok) {
          setResults([]);
          setSearched(true);
          setOpen(true);
          return;
        }
        const data = (await res.json()) as { results?: AddressAutocompleteResult[]; places?: NominatimPlace[] };
        const nextResults = Array.isArray(data.results)
          ? data.results.filter((item) => item.label)
          : Array.isArray(data.places)
            ? data.places.map(placeToAddress).filter((item) => item.label)
            : [];
        setResults(nextResults);
        setActiveIndex(0);
        setSearched(true);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResults([]);
          setSearched(true);
          setOpen(true);
        }
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
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-neutral-700">
          {label}
        </label>
      )}
      <input
        id={inputId}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && results[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setOpen(results.length > 0)}
        onKeyDown={(event) => {
          if (!open || results.length === 0) {
            if (event.key === "Escape") setOpen(false);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((index) => (index + 1) % results.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((index) => (index - 1 + results.length) % results.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            const activeResult = results[activeIndex];
            if (activeResult) selectResult(activeResult);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        className={
          inputClassName ||
          "w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-300"
        }
      />
      {open && (results.length > 0 || loading || (searched && query.trim().length >= 2)) && (
        <div id={listboxId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-lg">
          {loading && results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-500">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-sm text-neutral-500">
              No address matches yet. Add the city or ZIP, or enter the fields below.
            </div>
          ) : (
            results.map((result, index) => (
              <button
                key={`${result.label}:${result.lat}:${result.lng}`}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={activeIndex === index}
                className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50 aria-selected:bg-neutral-50"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectResult(result)}
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
