"use client";

import { useState } from "react";
import type { SellerLocationSearchResult } from "@/lib/sellerLocationSearchState";

export default function SellerLocationSearch({
  onSelect,
}: {
  onSelect: (location: SellerLocationSearchResult) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SellerLocationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function search() {
    setLoading(true);
    setMessage("");
    setResults([]);
    try {
      const response = await fetch(
        `/api/seller/location/search?q=${encodeURIComponent(query.trim())}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        results?: SellerLocationSearchResult[];
        error?: string;
      };
      if (!response.ok) {
        setMessage(body.error ?? "Location search is unavailable.");
        return;
      }
      const next = Array.isArray(body.results) ? body.results : [];
      setResults(next);
      if (next.length === 0) setMessage("No city or ZIP match found.");
    } catch {
      setMessage("Location search is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div role="search" className="flex gap-2">
        <label htmlFor="pickup-location-search" className="sr-only">
          Find city, state, or ZIP
        </label>
        <input
          id="pickup-location-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            if (loading || query.trim().length < 2) return;
            void search();
          }}
          placeholder="City, ST or ZIP"
          autoComplete="postal-code"
          className="min-w-0 flex-1 rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void search()}
          disabled={loading || query.trim().length < 2}
          className="rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>
      <p className="text-xs text-neutral-500">
        Search sends only a city and state or ZIP. It never sends your street address or dragged pin.
      </p>
      {message && <p role="status" className="text-sm text-neutral-600">{message}</p>}
      {results.length > 0 && (
        <div className="overflow-hidden rounded-md border border-neutral-200 bg-white">
          {results.map((result) => (
            <button
              key={`${result.label}:${result.lat}:${result.lng}`}
              type="button"
              className="block w-full px-3 py-2 text-left text-sm text-neutral-700 hover:bg-neutral-50"
              onClick={() => {
                onSelect(result);
                setResults([]);
                setMessage("Map moved to the selected area. Drag the pin to the location you want to save.");
              }}
            >
              {result.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
