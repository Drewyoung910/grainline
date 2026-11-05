"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { Check, ChevronDown, Filter, X } from "@/components/icons";
import { useBodyScrollLock, useDialogFocus } from "@/lib/dialogFocus";
import { normalizeTags } from "@/lib/tags";
import SegmentedControl from "@/components/SegmentedControl";
import { cleanBrowsePriceInput } from "@/lib/browsePriceInput";
import { browseSortLabel, visibleBrowseSortOptions } from "@/lib/browseSortOptions";

const SHIPS_WITHIN_OPTIONS = ["3", "7", "14", "30"];
const RATING_OPTIONS = ["4", "3", "2"];
const RADIUS_OPTIONS = ["10", "25", "50", "100"];

const filterLegendClass = "mb-2.5 block text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-600";

function choicePillClass(active: boolean) {
  return `inline-flex min-h-11 items-center rounded-full border px-4 text-sm transition-[background-color,border-color,color,box-shadow,scale] duration-200 motion-safe:active:scale-95 ${
    active
      ? "border-transparent bg-[#2C1F1A] text-[#FBF8F3] shadow-[0_5px_14px_-10px_rgba(44,31,26,0.9)]"
      : "border-transparent bg-white text-neutral-800 ring-1 ring-black/10 hover:bg-[#F0E9DE] hover:ring-black/5"
  }`;
}

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
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const filterSheetRef = React.useRef<HTMLDivElement>(null);
  const sortSheetRef = React.useRef<HTMLDivElement>(null);

  useDialogFocus(mobileOpen, filterSheetRef, () => setMobileOpen(false), { initialFocus: "container" });
  useDialogFocus(sortOpen, sortSheetRef, () => setSortOpen(false), { initialFocus: "container" });
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
            : "Could not detect your location. Try again."
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
  const [draftCategory, setDraftCategory] = React.useState(currentCategory);
  const [draftShips, setDraftShips] = React.useState(currentShips);
  const [draftRating, setDraftRating] = React.useState(currentRating);
  const [draftRadius, setDraftRadius] = React.useState(currentRadius);

  React.useEffect(() => {
    setDraftCategory(currentCategory);
    setDraftShips(currentShips);
    setDraftRating(currentRating);
    setDraftRadius(currentRadius);
  }, [currentCategory, currentRadius, currentRating, currentShips]);
  const hasAppliedPrice = Boolean(
    (currentMin && cleanBrowsePriceInput(currentMin) !== null)
    || (currentMax && cleanBrowsePriceInput(currentMax) !== null),
  );

  const sortLabel = browseSortLabel(q, currentSort, true);
  const sortOptions = visibleBrowseSortOptions(q, currentSort);

  const activeFilterCount = [
    currentCategory,
    currentType,
    currentShips,
    currentRating,
    searchParams.get("lat") && searchParams.get("lng") && currentRadius ? "loc" : null,
    hasAppliedPrice ? "price" : null,
    ...selectedTags,
  ].filter(Boolean).length;

  const filterFormId = `${baseId}-mobile-filters`;

  function openFilters() {
    setDraftCategory(currentCategory);
    setDraftShips(currentShips);
    setDraftRating(currentRating);
    setDraftRadius(currentRadius);
    setCategoryOpen(false);
    setMobileOpen(true);
  }

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
      {geoLat && geoLng && draftRadius && <input type="hidden" name="lat" value={geoLat} />}
      {geoLat && geoLng && draftRadius && <input type="hidden" name="lng" value={geoLng} />}
      {geoLat && geoLng && draftRadius && <input type="hidden" name="radius" value={draftRadius} />}
      <input type="hidden" name="sort" value={currentSort} />
      {/* Selected tags preserved as hidden inputs */}
      {selectedTags.map((t) => (
        <input key={t} type="hidden" name="tag" value={t} />
      ))}

      {/* Category */}
      <div>
        <span id={`${baseId}-mobile-category-label`} className={filterLegendClass}>Category</span>
        <input type="hidden" name="category" value={draftCategory} />
        <button
          type="button"
          aria-labelledby={`${baseId}-mobile-category-label`}
          aria-expanded={categoryOpen}
          aria-controls={`${baseId}-mobile-category-options`}
          onPointerUp={(event) => event.currentTarget.blur()}
          onClick={() => setCategoryOpen((open) => !open)}
          className="flex min-h-11 w-full items-center justify-between rounded-md border border-neutral-200 bg-white px-3.5 text-left text-[15px] font-medium text-neutral-900 shadow-[0_5px_18px_-14px_rgba(44,31,26,0.8)] transition-[background-color,box-shadow] hover:bg-[#F3EEE5]"
        >
          <span className="truncate">{draftCategory ? CATEGORY_LABELS[draftCategory] : "All categories"}</span>
          <ChevronDown
            aria-hidden="true"
            size={17}
            className={`shrink-0 text-neutral-500 transition-transform duration-300 ${categoryOpen ? "rotate-180" : ""}`}
          />
        </button>
        {categoryOpen && (
          <div
            id={`${baseId}-mobile-category-options`}
            role="radiogroup"
            aria-labelledby={`${baseId}-mobile-category-label`}
            className="mt-2 space-y-0.5 rounded-lg bg-[#EFEAE0]/70 p-1.5 animate-menu-in motion-reduce:animate-none"
          >
            {["", ...CATEGORY_VALUES].map((value) => {
              const selected = draftCategory === value;
              return (
                <button
                  key={value || "all"}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  onClick={() => {
                    setDraftCategory(value);
                    setCategoryOpen(false);
                  }}
                  className={`flex min-h-11 w-full items-center justify-between rounded-md px-3.5 text-left text-[15px] transition-[background-color,box-shadow,color] ${
                    selected
                      ? "bg-white font-semibold text-neutral-900 shadow-[0_5px_16px_-12px_rgba(44,31,26,0.75)]"
                      : "text-neutral-700 hover:bg-white/70"
                  }`}
                >
                  <span>{value ? CATEGORY_LABELS[value] : "All categories"}</span>
                  <Check
                    size={16}
                    className={`text-[#2C1F1A] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                      selected ? "scale-100 opacity-100" : "scale-50 opacity-0"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Availability (sliding toggle, submitted with the form) */}
      <fieldset>
        <legend className={filterLegendClass}>Availability</legend>
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
      <fieldset>
        <legend className={filterLegendClass}>Ships within</legend>
        <input type="hidden" name="ships" value={draftShips} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ships within">
          <button type="button" aria-pressed={!draftShips} onPointerUp={(event) => event.currentTarget.blur()} onClick={() => setDraftShips("")} className={choicePillClass(false)}>
            Any time
          </button>
          {SHIPS_WITHIN_OPTIONS.map((days) => (
            <button key={days} type="button" aria-pressed={draftShips === days} onPointerUp={(event) => event.currentTarget.blur()} onClick={() => setDraftShips(days)} className={choicePillClass(draftShips === days)}>
              {days} days
            </button>
          ))}
          {draftShips && !SHIPS_WITHIN_OPTIONS.includes(draftShips) && (
            <span aria-current="true" className={choicePillClass(true)}>{draftShips} days</span>
          )}
        </div>
      </fieldset>

      {/* Min seller rating */}
      <fieldset>
        <legend className={filterLegendClass}>Shop rating</legend>
        <input type="hidden" name="rating" value={draftRating} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Minimum shop rating">
          <button type="button" aria-pressed={!draftRating} onPointerUp={(event) => event.currentTarget.blur()} onClick={() => setDraftRating("")} className={choicePillClass(false)}>
            Any
          </button>
          {RATING_OPTIONS.map((stars) => (
            <button key={stars} type="button" aria-pressed={draftRating === stars} onPointerUp={(event) => event.currentTarget.blur()} onClick={() => setDraftRating(stars)} className={choicePillClass(draftRating === stars)}>
              <span>{stars}<span aria-hidden="true">★</span><span className="sr-only"> stars</span> and up</span>
            </button>
          ))}
        </div>
      </fieldset>

      {/* Price range */}
      <fieldset>
        <legend className={filterLegendClass}>Price (USD)</legend>
        <div className="flex items-center gap-2">
          <label htmlFor={`${baseId}-mobile-min`} className="sr-only">Minimum price</label>
          <input
            id={`${baseId}-mobile-min`}
            name="min"
            type="text"
            inputMode="decimal"
            defaultValue={currentMin}
            placeholder="Min"
            className="min-h-[44px] w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
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
            className="min-h-[44px] w-full rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm"
          />
        </div>
        {priceError && <p role="alert" className="mt-2 text-xs text-red-700">{priceError}</p>}
      </fieldset>

      {/* Location */}
      <fieldset>
        <legend className={filterLegendClass}>Near location</legend>
        <div className="space-y-2.5">
          {!(geoLat && geoLng) ? (
            <button
              type="button"
              onPointerUp={(event) => event.currentTarget.blur()}
              onClick={detectLocation}
              disabled={locating}
              className="btn btn-sm btn-secondary"
            >
              {locating ? "Finding you…" : "Use my location"}
            </button>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Distance from you">
                {RADIUS_OPTIONS.map((miles) => (
                  <button
                    key={miles}
                    type="button"
                    aria-pressed={draftRadius === miles}
                    onPointerUp={(event) => event.currentTarget.blur()}
                    onClick={() => setDraftRadius(miles)}
                    className={choicePillClass(draftRadius === miles)}
                  >
                    {miles} mi
                  </button>
                ))}
                {draftRadius && !RADIUS_OPTIONS.includes(draftRadius) && (
                  <span aria-current="true" className={choicePillClass(true)}>{draftRadius} mi</span>
                )}
              </div>
              {!draftRadius && <p className="text-xs text-neutral-600">Choose a distance from you.</p>}
              <button
                type="button"
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={() => {
                  setGeoLat("");
                  setGeoLng("");
                  setDraftRadius("");
                }}
                className="min-h-11 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
              >
                Clear location
              </button>
            </>
          )}
          {geoError && (
            <div role="alert" className="text-xs text-red-600">
              {geoError}
            </div>
          )}
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
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[85dvh] flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up focus:outline-none focus-visible:outline-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white md:hidden"
      >
        {/* Header row */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Filters</span>
          <button
            type="button"
            aria-label="Close filters"
            onPointerUp={(event) => event.currentTarget.blur()}
            onClick={() => setMobileOpen(false)}
            className="group flex size-11 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-[#EFEAE0] hover:text-neutral-900"
          >
            <X size={20} className="transition-transform duration-200 group-active:scale-90" />
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
        className="fixed inset-x-0 bottom-0 z-[61] flex max-h-[50dvh] flex-col rounded-t-3xl bg-white shadow-2xl animate-slide-up focus:outline-none focus-visible:outline-none after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-24 after:bg-white md:hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-100 shrink-0">
          <span className="font-semibold text-sm">Sort by</span>
          <button
            type="button"
            aria-label="Close sort"
            onPointerUp={(event) => event.currentTarget.blur()}
            onClick={() => setSortOpen(false)}
            className="group flex size-11 items-center justify-center rounded-full text-neutral-600 transition-colors hover:bg-[#EFEAE0] hover:text-neutral-900"
          >
            <X size={20} className="transition-transform duration-200 group-active:scale-90" />
          </button>
        </div>

        {/* Sort options — each navigates and closes sheet. Bottom padding
            keeps the last option clear of the iPhone home indicator. */}
        <div className="scrollbar-hidden overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
          {sortOptions.map(({ value, label }) => (
            <Link
              key={value}
              href={sortHref(value)}
              onClick={() => setSortOpen(false)}
              className={`flex min-h-11 items-center justify-between rounded-md px-3.5 py-2.5 text-[15px] transition-[background-color,box-shadow,color] hover:bg-[#F3EEE5] ${
                currentSort === value ? "bg-[#EFEAE0] font-semibold text-neutral-900" : "text-neutral-700"
              }`}
            >
              {label}
              <Check size={17} className={`text-[#2C1F1A] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${currentSort === value ? "scale-100 opacity-100" : "scale-50 opacity-0"}`} />
            </Link>
          ))}
        </div>
      </div>
    </>
  ) : null;

  return (
    <>
      {/* Sticky bar — only on mobile, sits above the listings flex container */}
      {/* Sticks just under the site header while the listings scroll */}
      <div className="md:hidden sticky top-[var(--site-header-offset)] z-30 -mx-4 -mt-4 flex items-center gap-3 border-b border-neutral-200 bg-[#F7F5F0] px-4 py-3 sm:-mx-6 sm:-mt-6 sm:px-6">
          <button
            onPointerUp={(event) => event.currentTarget.blur()}
            onClick={openFilters}
            className="btn btn-sm btn-secondary"
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
            onPointerUp={(event) => event.currentTarget.blur()}
            onClick={() => setSortOpen(true)}
            className="btn btn-sm btn-secondary"
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
