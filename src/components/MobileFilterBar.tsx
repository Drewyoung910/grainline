"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { Filter } from "@/components/icons";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { normalizeTags } from "@/lib/tags";
import SegmentedControl from "@/components/SegmentedControl";
import { cleanBrowsePriceInput } from "@/lib/browsePriceInput";

const SORT_LABELS: Record<string, string> = {
  relevant: "Relevant",
  newest: "Newest",
  price_asc: "Price ↑",
  price_desc: "Price ↓",
  popular: "Popular",
};

export default function MobileFilterBar({ popularTags }: { popularTags: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const baseId = React.useId();
  const q = searchParams.get("q") ?? "";
  const selectedTags = normalizeTags(searchParams.getAll("tag"), 10);
  const view = searchParams.get("view") ?? "grid";

  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [sortOpen, setSortOpen] = React.useState(false);
  const [geoLat, setGeoLat] = React.useState(searchParams.get("lat") ?? "");
  const [geoLng, setGeoLng] = React.useState(searchParams.get("lng") ?? "");
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const [priceError, setPriceError] = React.useState<string | null>(null);
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
  const hasAppliedPrice = Boolean(
    (currentMin && cleanBrowsePriceInput(currentMin) !== null)
    || (currentMax && cleanBrowsePriceInput(currentMax) !== null),
  );

  const sortLabel = SORT_LABELS[currentSort] ?? "Sort";

  const activeFilterCount = [
    currentCategory,
    currentType,
    currentShips,
    currentRating,
    geoLat && geoLng ? "loc" : null,
    hasAppliedPrice ? "price" : null,
    ...selectedTags,
  ].filter(Boolean).length;

  const filterFormId = `${baseId}-mobile-filters`;

  function handleFilterSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const min = cleanBrowsePriceInput(String(data.get("min") ?? ""));
    const max = cleanBrowsePriceInput(String(data.get("max") ?? ""));
    if (min === null || max === null) {
      setPriceError("Enter a price like $1,250 or 49.99.");
      return;
    }

    setPriceError(null);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value !== "string" || key === "min" || key === "max") continue;
      const trimmed = value.trim();
      if (trimmed) params.append(key, trimmed);
    }
    if (min) params.set("min", min);
    if (max) params.set("max", max);
    params.delete("page");

    setMobileOpen(false);
    const query = params.toString();
    router.push(query ? `/browse?${query}` : "/browse", { scroll: false });
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }

  const form = (
    <form
      key={searchParams.toString()}
      id={filterFormId}
      method="get"
      action="/browse"
      onSubmit={handleFilterSubmit}
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
        <label htmlFor={`${baseId}-mobile-category`} className="block font-medium mb-1.5">Category</label>
        <select
          id={`${baseId}-mobile-category`}
          name="category"
          defaultValue={currentCategory}
          className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORY_VALUES.map((v) => (
            <option key={v} value={v}>
              {CATEGORY_LABELS[v]}
            </option>
          ))}
        </select>
      </div>

      {/* Availability (sliding toggle, submitted with the form) */}
      <fieldset>
        <legend className="font-medium mb-1.5">Availability</legend>
        <SegmentedControl
          label="Availability"
          name="type"
          fullWidth
          value={currentType}
          options={[
            { value: "", label: "All" },
            { value: "IN_STOCK", label: "In stock" },
            { value: "MADE_TO_ORDER", label: "Made to order" },
          ]}
        />
      </fieldset>

      {/* Ships within */}
      <div>
        <label htmlFor={`${baseId}-mobile-ships`} className="block font-medium mb-1.5">Ships within (days)</label>
        <input
          id={`${baseId}-mobile-ships`}
          name="ships"
          type="number"
          inputMode="numeric"
          min="1"
          defaultValue={currentShips}
          placeholder="e.g. 7"
          className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
        />
      </div>

      {/* Min seller rating */}
      <div>
        <label htmlFor={`${baseId}-mobile-rating`} className="block font-medium mb-1.5">Min seller rating</label>
        <select
          id={`${baseId}-mobile-rating`}
          name="rating"
          defaultValue={currentRating}
          className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
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
          <label htmlFor={`${baseId}-mobile-min`} className="sr-only">Minimum price</label>
          <input
            id={`${baseId}-mobile-min`}
            name="min"
            type="text"
            inputMode="decimal"
            defaultValue={currentMin}
            placeholder="Min"
            className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
          <span className="text-neutral-500 shrink-0">–</span>
          <label htmlFor={`${baseId}-mobile-max`} className="sr-only">Maximum price</label>
          <input
            id={`${baseId}-mobile-max`}
            name="max"
            type="text"
            inputMode="decimal"
            defaultValue={currentMax}
            placeholder="Max"
            className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
        </div>
        {priceError && <p role="alert" className="mt-2 text-xs text-red-700">{priceError}</p>}
      </fieldset>

      {/* Sort */}
      <div>
        <label htmlFor={`${baseId}-mobile-sort`} className="block font-medium mb-1.5">Sort by</label>
        <select
          id={`${baseId}-mobile-sort`}
          name="sort"
          defaultValue={currentSort}
          className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
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
            className="min-h-[44px] rounded-xl border border-neutral-200 bg-white px-3 py-1 text-xs hover:bg-neutral-50"
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
          <label htmlFor={`${baseId}-mobile-radius`} className="sr-only">Radius in miles</label>
          <input
            id={`${baseId}-mobile-radius`}
            name="radius"
            type="number"
            inputMode="numeric"
            min="1"
            defaultValue={currentRadius}
            placeholder="Radius (miles)"
            className="min-h-[44px] w-full rounded-xl border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
        </div>
      </fieldset>
    </form>
  );

  // Apply/Reset stay pinned at the bottom of the sheet (outside the scroll
  // area) so they are reachable without scrolling past every filter. The
  // submit button is tied to the form through its `form` attribute.
  const filterActions = (
    <div className="flex gap-2">
      <button
        type="submit"
        form={filterFormId}
        className="btn btn-sm btn-primary flex-1"
      >
        Apply
      </button>
      <Link
        href={q ? `/browse?q=${encodeURIComponent(q)}` : "/browse"}
        onClick={() => {
          setPriceError(null);
          setMobileOpen(false);
        }}
        className="btn btn-sm btn-secondary"
      >
        Reset
      </Link>
    </div>
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
              className={`inline-flex min-h-[44px] items-center rounded-full px-3 py-1 text-xs transition-colors ${
                active
                  ? "bg-[#2C1F1A] text-white"
                  : "bg-[#EFEAE0] text-neutral-800 hover:bg-[#E3DCCB]"
              }`}
            >
              {t.replace(/[-_]+/g, " ")}
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
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-[#2C1F1A] text-white"
            >
              {t.replace(/[-_]+/g, " ")} <span className="opacity-70">✕</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const sheet = mobileOpen ? (
    <>
      {/* Backdrop — z-[60]/z-[61] sit above the site header (z-50) so the
          header is dimmed and can't be tapped while this modal sheet is open */}
      <div
        className="fixed inset-0 z-[60] bg-[#14100D]/40 modal-backdrop-in md:hidden"
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sheet panel — rounded top only, max-h caps height but allows shorter
          content to show shorter sheet. dvh tracks the visible viewport on
          iOS; the white ::after strip keeps the sheet's colour under the
          home indicator/toolbar area. */}
      <div
        ref={filterSheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        tabIndex={-1}
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white md:hidden"
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Filters</span>
          <button
            onClick={() => setMobileOpen(false)}
            className="rounded-full bg-[#EFEAE0] px-3.5 py-1 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors min-h-[44px]"
          >
            Close
          </button>
        </div>

        {/* Scrollable content */}
        <div className="scrollbar-hidden overflow-y-auto overscroll-contain flex-1 px-4 py-4">
          {form}
          {tagsSection}
        </div>

        {/* Pinned actions, padded clear of the iPhone home indicator */}
        <div className="shrink-0 border-t border-neutral-100 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {filterActions}
        </div>
      </div>
    </>
  ) : null;

  const sortSheet = sortOpen ? (
    <>
      {/* Backdrop — above the site header, same as the filter sheet */}
      <div
        className="fixed inset-0 z-[60] bg-[#14100D]/40 modal-backdrop-in md:hidden"
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
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[50dvh] flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white md:hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Sort by</span>
          <button
            onClick={() => setSortOpen(false)}
            className="rounded-full bg-[#EFEAE0] px-3.5 py-1 text-sm font-medium text-neutral-800 hover:bg-[#E3DCCB] transition-colors min-h-[44px]"
          >
            Close
          </button>
        </div>

        {/* Sort options — each navigates and closes sheet. Bottom padding
            keeps the last option clear of the iPhone home indicator. */}
        <div className="scrollbar-hidden overflow-y-auto overscroll-contain pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
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
      <div className="md:hidden sticky top-[var(--site-header-offset)] z-30 bg-[#F7F5F0] border-b border-neutral-200 -mx-4 px-4 pt-3 pb-3 flex items-center gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="btn btn-sm btn-secondary mt-0.5"
          >
            <Filter size={16} />
            Filters
            {activeFilterCount > 0 && (
              <span className="inline-flex items-center rounded-full bg-[#2C1F1A] text-white px-1.5 py-0.5 text-[11px] font-medium leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setSortOpen(true)}
            className="btn btn-sm btn-secondary mt-0.5"
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
