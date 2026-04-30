"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";

export default function FilterSidebar({ popularTags }: { popularTags: string[] }) {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const selectedTags = searchParams.getAll("tag");
  const view = searchParams.get("view") ?? "grid";

  const [geoLat, setGeoLat] = React.useState(searchParams.get("lat") ?? "");
  const [geoLng, setGeoLng] = React.useState(searchParams.get("lng") ?? "");
  const [locating, setLocating] = React.useState(false);

  function detectLocation() {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(pos.coords.latitude.toFixed(5));
        setGeoLng(pos.coords.longitude.toFixed(5));
        setLocating(false);
      },
      () => setLocating(false)
    );
  }

  function tagToggleHref(tag: string) {
    const p = new URLSearchParams(searchParams.toString());
    const current = p.getAll("tag");
    p.delete("tag");
    p.delete("page");
    if (current.includes(tag)) {
      current.filter((t) => t !== tag).forEach((t) => p.append("tag", t));
    } else {
      [...current, tag].forEach((t) => p.append("tag", t));
    }
    return `/browse?${p.toString()}`;
  }

  // Re-sync geo state when URL changes (e.g. after Apply)
  React.useEffect(() => {
    setGeoLat(searchParams.get("lat") ?? "");
    setGeoLng(searchParams.get("lng") ?? "");
  }, [searchParams]);

  const currentCategory = searchParams.get("category") ?? "";
  const currentType = searchParams.get("type") ?? "";
  const currentShips = searchParams.get("ships") ?? "";
  const currentRating = searchParams.get("rating") ?? "";
  const currentMin = searchParams.get("min") ?? "";
  const currentMax = searchParams.get("max") ?? "";
  const currentSort = searchParams.get("sort") ?? (q ? "relevant" : "newest");
  const currentRadius = searchParams.get("radius") ?? "";

  const form = (
    <form
      key={searchParams.toString()}
      method="get"
      action="/browse"
      className="space-y-5 text-sm"
    >
      {/* Preserve q and view */}
      {q && <input type="hidden" name="q" value={q} />}
      {view !== "grid" && <input type="hidden" name="view" value={view} />}
      {geoLat && <input type="hidden" name="lat" value={geoLat} />}
      {geoLng && <input type="hidden" name="lng" value={geoLng} />}
      {/* Selected tags preserved as hidden inputs */}
      {selectedTags.map((t) => (
        <input key={t} type="hidden" name="tag" value={t} />
      ))}

      {/* Category */}
      <div>
        <label className="block font-medium mb-1.5">Category</label>
        <select
          name="category"
          defaultValue={currentCategory}
          className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          <option value="">All categories</option>
          {CATEGORY_VALUES.map((v) => (
            <option key={v} value={v}>
              {CATEGORY_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {/* Listing type */}
      <div>
        <div className="font-medium mb-1.5">Listing type</div>
        <div className="space-y-1.5">
          {[
            { value: "", label: "All" },
            { value: "IN_STOCK", label: "In Stock" },
            { value: "MADE_TO_ORDER", label: "Made to Order" },
          ].map(({ value, label }) => (
            <label key={value} className="flex items-center gap-2 cursor-pointer min-h-[44px]">
              <input
                type="radio"
                name="type"
                value={value}
                defaultChecked={currentType === value}
                className="accent-neutral-900"
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Ships within */}
      <div>
        <label className="block font-medium mb-1.5">Ships within (days)</label>
        <input
          name="ships"
          type="number"
          min="1"
          defaultValue={currentShips}
          placeholder="e.g. 7"
          className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* Min seller rating */}
      <div>
        <label className="block font-medium mb-1.5">Min seller rating</label>
        <select
          name="rating"
          defaultValue={currentRating}
          className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          <option value="">Any rating</option>
          <option value="4">★★★★ and up</option>
          <option value="3">★★★ and up</option>
          <option value="2">★★ and up</option>
        </select>
      </div>

      {/* Price range */}
      <div>
        <div className="font-medium mb-1.5">Price (USD)</div>
        <div className="flex items-center gap-2">
          <input
            name="min"
            type="number"
            step="0.01"
            min="0"
            defaultValue={currentMin}
            placeholder="Min"
            className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <span className="text-neutral-500 shrink-0">–</span>
          <input
            name="max"
            type="number"
            step="0.01"
            min="0"
            defaultValue={currentMax}
            placeholder="Max"
            className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="block font-medium mb-1.5">Sort by</label>
        <select
          name="sort"
          defaultValue={currentSort}
          className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          {q && <option value="relevant">Most relevant</option>}
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
          <option value="popular">Most popular</option>
        </select>
      </div>

      {/* Location */}
      <div>
        <div className="font-medium mb-1.5">Near location</div>
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={detectLocation}
            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs hover:bg-neutral-50 min-h-[44px]"
          >
            {locating ? "Detecting…" : "Use my location"}
          </button>
          {(geoLat || geoLng) && (
            <div className="text-xs text-neutral-500 truncate">
              {geoLat}, {geoLng}
            </div>
          )}
          <input
            name="radius"
            type="number"
            min="1"
            defaultValue={currentRadius}
            placeholder="Radius (miles)"
            className="w-full rounded-md border border-neutral-200 bg-white text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 bg-neutral-900 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-neutral-800 min-h-[44px]"
        >
          Apply
        </button>
        <Link
          href={q ? `/browse?q=${encodeURIComponent(q)}` : "/browse"}
          className="text-sm text-neutral-500 hover:text-neutral-700 min-h-[44px] flex items-center px-3"
        >
          Reset
        </Link>
      </div>
    </form>
  );

  const tagsSection = popularTags.length > 0 && (
    <div className="mt-5 pt-4 border-t border-neutral-100">
      <div className="font-medium mb-2 text-sm">Popular tags</div>
      <div className="flex flex-wrap gap-1.5">
        {popularTags.map((t) => {
          const active = selectedTags.includes(t);
          return (
            <Link
              key={t}
              href={tagToggleHref(t)}
              className={`rounded-full border border-neutral-200 px-2.5 py-0.5 text-xs hover:bg-neutral-50 ${
                active ? "bg-neutral-900 text-white hover:bg-neutral-900 border-neutral-900" : ""
              }`}
            >
              #{t}
            </Link>
          );
        })}
      </div>

      {selectedTags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selectedTags.map((t) => (
            <Link
              key={t}
              href={tagToggleHref(t)}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs bg-neutral-900 text-white"
            >
              #{t} <span className="opacity-70">✕</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden md:block w-52 lg:w-56 shrink-0">
        <div className="card-section p-4 sticky top-4">
          {form}
          {tagsSection}
        </div>
      </aside>
    </>
  );
}
