"use client";
import * as React from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { normalizeTags } from "@/lib/tags";

export default function FilterSidebar({ popularTags }: { popularTags: string[] }) {
  const searchParams = useSearchParams();
  const baseId = React.useId();
  const q = searchParams.get("q") ?? "";
  const selectedTags = normalizeTags(searchParams.getAll("tag"), 10);
  const view = searchParams.get("view") ?? "grid";

  const [geoLat, setGeoLat] = React.useState(searchParams.get("lat") ?? "");
  const [geoLng, setGeoLng] = React.useState(searchParams.get("lng") ?? "");
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);

  function detectLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Location is not available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLat(pos.coords.latitude.toFixed(5));
        setGeoLng(pos.coords.longitude.toFixed(5));
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Could not detect your location. Try again or enter a radius without location filtering."
        );
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 }
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
        <label htmlFor={`${baseId}-category`} className="block font-medium mb-1.5">Category</label>
        <select
          id={`${baseId}-category`}
          name="category"
          defaultValue={currentCategory}
          className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
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
      <fieldset>
        <legend className="font-medium mb-1.5">Listing type</legend>
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
      </fieldset>

      {/* Ships within */}
      <div>
        <label htmlFor={`${baseId}-ships`} className="block font-medium mb-1.5">Ships within (days)</label>
        <input
          id={`${baseId}-ships`}
          name="ships"
          type="number"
          inputMode="numeric"
          min="1"
          max="365"
          defaultValue={currentShips}
          placeholder="e.g. 7"
          className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        />
      </div>

      {/* Min seller rating */}
      <div>
        <label htmlFor={`${baseId}-rating`} className="block font-medium mb-1.5">Min seller rating</label>
        <select
          id={`${baseId}-rating`}
          name="rating"
          defaultValue={currentRating}
          className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          <option value="">Any rating</option>
          <option value="4">★★★★ and up</option>
          <option value="3">★★★ and up</option>
          <option value="2">★★ and up</option>
        </select>
      </div>

      {/* Price range */}
      <fieldset>
        <legend className="font-medium mb-1.5">Price (USD)</legend>
        <div className="flex items-center gap-2">
          <label htmlFor={`${baseId}-min`} className="sr-only">Minimum price</label>
          <input
            id={`${baseId}-min`}
            name="min"
            type="text"
            inputMode="decimal"
            pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
            defaultValue={currentMin}
            placeholder="Min"
            className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
          <span className="text-neutral-500 shrink-0">–</span>
          <label htmlFor={`${baseId}-max`} className="sr-only">Maximum price</label>
          <input
            id={`${baseId}-max`}
            name="max"
            type="text"
            inputMode="decimal"
            pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
            defaultValue={currentMax}
            placeholder="Max"
            className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
        </div>
      </fieldset>

      {/* Sort */}
      <div>
        <label htmlFor={`${baseId}-sort`} className="block font-medium mb-1.5">Sort by</label>
        <select
          id={`${baseId}-sort`}
          name="sort"
          defaultValue={currentSort}
          className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
        >
          {q && <option value="relevant">Most relevant</option>}
          <option value="newest">Newest</option>
          <option value="price_asc">Price: Low → High</option>
          <option value="price_desc">Price: High → Low</option>
          <option value="popular">Most popular</option>
        </select>
      </div>

      {/* Location */}
      <fieldset>
        <legend className="font-medium mb-1.5">Near location</legend>
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
          {geoError && (
            <div role="alert" className="text-xs text-red-600">
              {geoError}
            </div>
          )}
          <label htmlFor={`${baseId}-radius`} className="sr-only">Radius in miles</label>
          <input
            id={`${baseId}-radius`}
            name="radius"
            type="number"
            inputMode="numeric"
            min="1"
            max="500"
            defaultValue={currentRadius}
            placeholder="Radius (miles)"
            className="w-full rounded-md border border-neutral-200 bg-[#F7F5F0] text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-300"
          />
        </div>
      </fieldset>

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
              className={`rounded-full border border-neutral-200 bg-[#F7F5F0] px-2.5 py-0.5 text-xs hover:bg-white transition-colors ${
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
        <div className="rounded-lg border border-stone-200/60 bg-[#EFEAE0] shadow-sm p-4 sticky top-4">
          {form}
          {tagsSection}
        </div>
      </aside>
    </>
  );
}
