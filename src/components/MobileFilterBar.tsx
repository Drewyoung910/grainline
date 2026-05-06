"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { Filter } from "@/components/icons";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";

const SORT_LABELS: Record<string, string> = {
  relevant: "Relevant",
  newest: "Newest",
  price_asc: "Price ↑",
  price_desc: "Price ↓",
  popular: "Popular",
};

export default function MobileFilterBar({ popularTags }: { popularTags: string[] }) {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const selectedTags = searchParams.getAll("tag");
  const view = searchParams.get("view") ?? "grid";

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [geoLat, setGeoLat] = React.useState(searchParams.get("lat") ?? "");
  const [geoLng, setGeoLng] = React.useState(searchParams.get("lng") ?? "");
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const filterSheetRef = React.useRef<HTMLDivElement>(null);
  const sortSheetRef = React.useRef<HTMLDivElement>(null);

  useDialogFocus(mobileOpen, filterSheetRef, () => setMobileOpen(false));
  useDialogFocus(sortOpen, sortSheetRef, () => setSortOpen(false));
  useBodyScrollLock(mobileOpen || sortOpen);

  React.useEffect(() => {
    setMounted(true);
  }, []);

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

  function sortHref(sort: string) {
    const p = new URLSearchParams(searchParams.toString());
    p.set("sort", sort);
    p.delete("page");
    return `/browse?${p.toString()}`;
  }

  // Re-sync geo state and close sheets when URL changes (e.g. after Apply or sort click)
  React.useEffect(() => {
    setGeoLat(searchParams.get("lat") ?? "");
    setGeoLng(searchParams.get("lng") ?? "");
    setMobileOpen(false);
    setSortOpen(false);
  }, [searchParams]);

  const currentCategory = searchParams.get("category") ?? "";
  const currentType = searchParams.get("type") ?? "";
  const currentShips = searchParams.get("ships") ?? "";
  const currentRating = searchParams.get("rating") ?? "";
  const currentMin = searchParams.get("min") ?? "";
  const currentMax = searchParams.get("max") ?? "";
  const currentSort = searchParams.get("sort") ?? (q ? "relevant" : "newest");
  const currentRadius = searchParams.get("radius") ?? "";

  const sortLabel = SORT_LABELS[currentSort] ?? "Sort";

  const activeFilterCount = [
    currentCategory,
    currentType,
    currentShips,
    currentRating,
    geoLat && geoLng ? "loc" : null,
    currentMin,
    currentMax,
    ...selectedTags,
  ].filter(Boolean).length;

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
          className="w-full rounded border px-2 py-1.5 text-sm min-h-[44px]"
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
          inputMode="numeric"
          min="1"
          defaultValue={currentShips}
          placeholder="e.g. 7"
          className="w-full rounded border px-2 py-1.5 min-h-[44px]"
        />
      </div>

      {/* Min seller rating */}
      <div>
        <label className="block font-medium mb-1.5">Min seller rating</label>
        <select
          name="rating"
          defaultValue={currentRating}
          className="w-full rounded border px-2 py-1.5 min-h-[44px]"
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
            type="text"
            inputMode="decimal"
            pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
            defaultValue={currentMin}
            placeholder="Min"
            className="w-full rounded border px-2 py-1.5 min-h-[44px]"
          />
          <span className="text-neutral-500 shrink-0">–</span>
          <input
            name="max"
            type="text"
            inputMode="decimal"
            pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
            defaultValue={currentMax}
            placeholder="Max"
            className="w-full rounded border px-2 py-1.5 min-h-[44px]"
          />
        </div>
      </div>

      {/* Sort */}
      <div>
        <label className="block font-medium mb-1.5">Sort by</label>
        <select
          name="sort"
          defaultValue={currentSort}
          className="w-full rounded border px-2 py-1.5 min-h-[44px]"
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
            className="rounded border px-2.5 py-1 text-xs hover:bg-neutral-50 min-h-[44px]"
          >
            {locating ? "Detecting…" : "Use my location"}
          </button>
          {(geoLat || geoLng) && (
            <div className="text-xs text-neutral-500 truncate">
              {geoLat}, {geoLng}
            </div>
          )}
          {geoError && (
            <div className="text-xs text-red-600">
              {geoError}
            </div>
          )}
          <input
            name="radius"
            type="number"
            inputMode="numeric"
            min="1"
            defaultValue={currentRadius}
            placeholder="Radius (miles)"
            className="w-full rounded border px-2 py-1.5 min-h-[44px]"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          className="flex-1 rounded border px-3 py-1.5 font-medium hover:bg-neutral-50 min-h-[44px]"
        >
          Apply
        </button>
        <Link
          href={q ? `/browse?q=${encodeURIComponent(q)}` : "/browse"}
          className="rounded border px-3 py-1.5 text-neutral-600 hover:bg-neutral-50 min-h-[44px] flex items-center"
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
              className={`inline-flex min-h-[44px] items-center rounded-full border border-neutral-200 px-3 py-1 text-xs hover:bg-neutral-50 ${
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 py-1 text-xs bg-neutral-900 text-white"
            >
              #{t} <span className="opacity-70">✕</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const sheet = mobileOpen ? (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sheet panel — rounded top only, max-h caps height but allows shorter content to show shorter sheet */}
      <div
        ref={filterSheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl max-h-[85vh] md:hidden animate-slide-up shadow-2xl"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>

        {/* Header row */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Filters</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 min-h-[44px]"
          >
            Close
          </button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 py-4">
          {form}
          {tagsSection}
        </div>
      </div>
    </>
  ) : null;

  const sortSheet = sortOpen ? (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 md:hidden"
        onClick={() => setSortOpen(false)}
        aria-hidden="true"
      />

      {/* Sort sheet panel — smaller max-h so short list shows a compact sheet */}
      <div
        ref={sortSheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Sort listings"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-50 flex flex-col bg-white rounded-t-2xl max-h-[50vh] md:hidden animate-slide-up shadow-2xl"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2 shrink-0">
          <div className="h-1 w-10 rounded-full bg-neutral-300" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Sort by</span>
          <button
            onClick={() => setSortOpen(false)}
            className="rounded border px-3 py-1 text-sm hover:bg-neutral-50 min-h-[44px]"
          >
            Close
          </button>
        </div>

        {/* Sort options — each navigates and closes sheet */}
        <div className="py-2">
          {q && (
            <Link
              href={sortHref("relevant")}
              onClick={() => setSortOpen(false)}
              className={`flex items-center justify-between px-4 py-3 text-sm min-h-[44px] hover:bg-neutral-50 ${
                currentSort === "relevant" ? "font-semibold text-neutral-900" : "text-neutral-700"
              }`}
            >
              Most relevant
              {currentSort === "relevant" && <span className="text-neutral-500 text-base">✓</span>}
            </Link>
          )}
          {[
            { value: "newest", label: "Newest" },
            { value: "price_asc", label: "Price: Low → High" },
            { value: "price_desc", label: "Price: High → Low" },
            { value: "popular", label: "Most popular" },
          ].map(({ value, label }) => (
            <Link
              key={value}
              href={sortHref(value)}
              onClick={() => setSortOpen(false)}
              className={`flex items-center justify-between px-4 py-3 text-sm min-h-[44px] hover:bg-neutral-50 ${
                currentSort === value ? "font-semibold text-neutral-900" : "text-neutral-700"
              }`}
            >
              {label}
              {currentSort === value && <span className="text-neutral-500 text-base">✓</span>}
            </Link>
          ))}
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      {/* Sticky bar — only on mobile, sits above the listings flex container */}
      {/* top-[2px] + pt-3 pulls bar 2px below viewport top so button outlines aren't clipped */}
      <div className="md:hidden sticky top-[2px] z-30 bg-[#F7F5F0] border-b border-neutral-200 -mx-4 px-4 pt-3 pb-3 flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="mt-[2px] inline-flex items-center gap-2 rounded border bg-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 min-h-[44px]"
          >
            <Filter size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-neutral-900 text-white px-1.5 py-0.5 text-[11px] font-medium leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setSortOpen(true)}
            className="mt-[2px] inline-flex items-center gap-2 rounded border bg-white px-4 py-2.5 text-sm font-medium hover:bg-neutral-50 min-h-[44px]"
          >
            Sort: {sortLabel}
          </button>
      </div>

      {/* Portal sheets — rendered at document.body to escape all stacking contexts */}
      {mounted && sheet ? createPortal(sheet, document.body) : null}
      {mounted && sortSheet ? createPortal(sortSheet, document.body) : null}
    </>
  );
}
