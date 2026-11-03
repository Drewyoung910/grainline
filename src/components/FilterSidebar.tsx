"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { normalizeTags } from "@/lib/tags";
import SegmentedControl from "@/components/SegmentedControl";
import { ChevronDown } from "@/components/icons";
import { cleanBrowsePriceInput } from "@/lib/browsePriceInput";

// Every change applies at once and glides the page back to the top of the
// results (the motion study's floating filter column).
function scrollResultsToTop() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

const SHIPS_WITHIN_OPTIONS = ["3", "7", "14", "30"];
const RATING_OPTIONS = ["4", "3", "2"];
const RADIUS_OPTIONS = ["10", "25", "50", "100"];

const legendClass = "mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-600";

function chipClass(active: boolean) {
  return `inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-[background-color,border-color,color,box-shadow,scale] duration-200 motion-safe:active:scale-95 ${
    active
      ? "border-transparent bg-[#2C1F1A] text-[#FBF8F3] shadow-[0_5px_14px_-10px_rgba(44,31,26,0.9)]"
      : "border-transparent bg-white text-neutral-800 ring-1 ring-black/10 hover:bg-[#F0E9DE] hover:ring-black/5"
  }`;
}

export default function FilterSidebar({ popularTags }: { popularTags: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const pendingParamsRef = React.useRef(searchKey);
  React.useEffect(() => {
    pendingParamsRef.current = searchKey;
  }, [searchKey]);
  const baseId = React.useId();
  const categoryMenuRef = React.useRef<HTMLDivElement>(null);
  const categoryButtonRef = React.useRef<HTMLButtonElement>(null);
  const categoryCloseTimerRef = React.useRef<number | null>(null);
  const [categoryOpen, setCategoryOpen] = React.useState(false);
  const [categoryClosing, setCategoryClosing] = React.useState(false);
  const q = searchParams.get("q") ?? "";
  const selectedTags = normalizeTags(searchParams.getAll("tag"), 10);

  const currentCategory = searchParams.get("category") ?? "";
  const currentType = searchParams.get("type") ?? "";
  const currentShips = searchParams.get("ships") ?? "";
  const currentRating = searchParams.get("rating") ?? "";
  const currentMin = searchParams.get("min") ?? "";
  const currentMax = searchParams.get("max") ?? "";
  const currentRadius = searchParams.get("radius") ?? "";
  const urlLat = searchParams.get("lat") ?? "";
  const urlLng = searchParams.get("lng") ?? "";

  // Paint filter choices immediately while the server navigation catches up.
  // Availability already does this inside SegmentedControl; the compact
  // category control and chip groups should feel equally responsive.
  const [pendingCategory, setPendingCategory] = React.useState(currentCategory);
  const [pendingShips, setPendingShips] = React.useState(currentShips);
  const [pendingRating, setPendingRating] = React.useState(currentRating);
  React.useEffect(() => {
    setPendingCategory(currentCategory);
    setPendingShips(currentShips);
    setPendingRating(currentRating);
  }, [currentCategory, currentRating, currentShips, searchKey]);

  const [geo, setGeo] = React.useState<{ lat: string; lng: string } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const lat = geo?.lat ?? urlLat;
  const lng = geo?.lng ?? urlLng;

  // Once a detected point has reached the URL, let the URL become the source
  // of truth again. Otherwise removing the location filter leaves the stale
  // detected point painted as active even though the results are unfiltered.
  React.useEffect(() => {
    if (geo?.lat === urlLat && geo?.lng === urlLng) setGeo(null);
  }, [geo, urlLat, urlLng]);

  // The price fields are controlled so a typed price survives the page
  // refreshing around it, and so every other filter link carries it along:
  // clicking a category right after typing a price keeps both.
  const minRef = React.useRef<HTMLInputElement>(null);
  const maxRef = React.useRef<HTMLInputElement>(null);
  const [minInput, setMinInput] = React.useState(currentMin);
  const [maxInput, setMaxInput] = React.useState(currentMax);
  const [priceError, setPriceError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (document.activeElement !== minRef.current) setMinInput(currentMin);
    if (document.activeElement !== maxRef.current) setMaxInput(currentMax);
  }, [currentMin, currentMax]);
  const pendingMin = cleanBrowsePriceInput(minInput);
  const pendingMax = cleanBrowsePriceInput(maxInput);

  function hrefWith(changes: Record<string, string | null>, baseQuery = searchKey) {
    const params = new URLSearchParams(baseQuery);
    const price: Record<string, string | null> = {};
    if (pendingMin !== null) price.min = pendingMin;
    if (pendingMax !== null) price.max = pendingMax;
    for (const [key, value] of Object.entries({ ...price, ...changes })) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    params.delete("page");
    const query = params.toString();
    return query ? `/browse?${query}` : "/browse";
  }

  function go(href: string) {
    router.push(href, { scroll: false });
    scrollResultsToTop();
  }

  function navigateWith(changes: Record<string, string | null>) {
    const href = hrefWith(changes, pendingParamsRef.current);
    pendingParamsRef.current = href.split("?")[1] ?? "";
    go(href);
  }

  function handleFilterLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const encoded = event.currentTarget.dataset.filterChanges;
    if (!encoded) return;
    const changes = JSON.parse(encoded) as Record<string, string | null>;
    const href = hrefWith(changes, pendingParamsRef.current);
    pendingParamsRef.current = href.split("?")[1] ?? "";
    go(href);
  }

  function handleTagLinkClick(event: React.MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    event.preventDefault();
    const tag = event.currentTarget.dataset.filterTag;
    if (!tag) return;
    const href = tagToggleHref(tag, pendingParamsRef.current);
    pendingParamsRef.current = href.split("?")[1] ?? "";
    go(href);
  }

  function tagToggleHref(tag: string, baseQuery = searchKey) {
    const params = new URLSearchParams(hrefWith({}, baseQuery).split("?")[1] ?? "");
    const current = params.getAll("tag");
    params.delete("tag");
    params.delete("page");
    if (current.includes(tag)) {
      current.filter((t) => t !== tag).forEach((t) => params.append("tag", t));
    } else {
      [...current, tag].forEach((t) => params.append("tag", t));
    }
    return `/browse?${params.toString()}`;
  }

  function detectLocation() {
    setGeoError(null);
    if (!navigator.geolocation) {
      setGeoError("Location is not available in this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        focusDistanceRef.current = true;
        setGeo({ lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) });
        setLocating(false);
      },
      (error) => {
        setLocating(false);
        setGeoError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Could not detect your location. Try again in a moment."
        );
      },
      { enableHighAccuracy: false, maximumAge: 300000, timeout: 8000 }
    );
  }

  // Once "Use my location" succeeds its button is gone, so focus moves to
  // the distance choices that replace it.
  const focusDistanceRef = React.useRef(false);
  const distanceGroupRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!geo || !focusDistanceRef.current) return;
    focusDistanceRef.current = false;
    distanceGroupRef.current?.querySelector<HTMLElement>("a")?.focus();
  }, [geo]);

  // Price applies on Enter, or when focus leaves both price fields with a new
  // value. Moving from Min to Max does not navigate.
  const priceFormRef = React.useRef<HTMLFormElement>(null);
  const applyPrice = () => {
    if (pendingMin === null || pendingMax === null) {
      setPriceError("Enter a price like 50 or 49.99.");
      return;
    }
    setPriceError(null);
    if (pendingMin !== minInput) setMinInput(pendingMin);
    if (pendingMax !== maxInput) setMaxInput(pendingMax);
    if (pendingMin === currentMin && pendingMax === currentMax) return;
    navigateWith({ min: pendingMin, max: pendingMax });
  };
  const onPriceBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (priceFormRef.current?.contains(event.relatedTarget as Node | null)) return;
    applyPrice();
  };

  const hasLocation = Boolean(lat && lng);

  const closeCategoryMenu = React.useCallback((returnFocus = false) => {
    if (!categoryOpen || categoryCloseTimerRef.current !== null) return;
    setCategoryClosing(true);
    categoryCloseTimerRef.current = window.setTimeout(() => {
      categoryCloseTimerRef.current = null;
      setCategoryClosing(false);
      setCategoryOpen(false);
      if (returnFocus) categoryButtonRef.current?.focus({ preventScroll: true });
    }, 140);
  }, [categoryOpen]);

  React.useEffect(() => {
    if (!categoryOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!categoryMenuRef.current?.contains(event.target as Node)) closeCategoryMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeCategoryMenu(true);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [categoryOpen, closeCategoryMenu]);

  React.useEffect(() => () => {
    if (categoryCloseTimerRef.current !== null) window.clearTimeout(categoryCloseTimerRef.current);
  }, []);

  return (
    <aside aria-label="Filters" className="hidden md:block w-56 lg:w-60 shrink-0">
      <div className="-ml-1 space-y-5 pb-8 pl-1 pr-2 pt-1 text-sm">
        {/* Category */}
        <div>
          <div id={`${baseId}-category`} className={legendClass}>Category</div>
          <div ref={categoryMenuRef} className="relative">
            <button
              ref={categoryButtonRef}
              type="button"
              aria-labelledby={`${baseId}-category`}
              aria-haspopup="true"
              aria-expanded={categoryOpen && !categoryClosing}
              aria-controls={categoryOpen ? `${baseId}-category-options` : undefined}
              onPointerUp={(event) => event.currentTarget.blur()}
              onClick={() => {
                if (categoryCloseTimerRef.current !== null) {
                  window.clearTimeout(categoryCloseTimerRef.current);
                  categoryCloseTimerRef.current = null;
                }
                if (categoryOpen) closeCategoryMenu();
                else {
                  setCategoryClosing(false);
                  setCategoryOpen(true);
                }
              }}
              className="flex h-10 w-full items-center justify-between rounded-xl border border-neutral-200 bg-white px-3 text-left text-[14.5px] font-medium text-neutral-900 shadow-[0_5px_18px_-14px_rgba(44,31,26,0.8)] transition-[background-color,border-color,box-shadow] hover:border-neutral-200 hover:bg-[#F3EEE5]"
            >
              <span className="truncate">{pendingCategory ? CATEGORY_LABELS[pendingCategory] : "All categories"}</span>
              <ChevronDown aria-hidden="true" size={16} className={`shrink-0 text-neutral-500 transition-transform duration-300 ${categoryOpen && !categoryClosing ? "rotate-180" : ""}`} />
            </button>
            {categoryOpen && (
              <nav
                id={`${baseId}-category-options`}
                aria-labelledby={`${baseId}-category`}
                className={`scrollbar-hidden absolute left-0 right-0 top-[calc(100%+0.5rem)] z-40 max-h-[min(26rem,calc(100dvh-var(--site-header-offset)-4rem))] origin-top overflow-y-auto rounded-2xl bg-white p-1.5 popover-shadow motion-reduce:animate-none ${
                  categoryClosing ? "pointer-events-none animate-menu-out" : "animate-menu-in"
                }`}
              >
                {["", ...CATEGORY_VALUES].map((value) => {
                  const selected = pendingCategory === value;
                  return (
                    <Link
                      key={value || "all"}
                      href={hrefWith({ category: value || null })}
                      scroll={false}
                      aria-current={selected ? "page" : undefined}
                      data-filter-changes={JSON.stringify({ category: value || null })}
                      onPointerUp={(event) => event.currentTarget.blur()}
                      onClick={(event) => {
                        setPendingCategory(value);
                        handleFilterLinkClick(event);
                        setCategoryClosing(false);
                        setCategoryOpen(false);
                      }}
                      className={`flex min-h-10 items-center rounded-xl px-3 text-[14.5px] transition-colors hover:bg-[#F3EEE5] ${
                        selected ? "bg-[#EFEAE0] font-semibold text-neutral-900" : "text-neutral-700"
                      }`}
                    >
                      {value ? CATEGORY_LABELS[value] : "All categories"}
                    </Link>
                  );
                })}
              </nav>
            )}
          </div>
        </div>

        {/* Availability */}
        <fieldset>
          <legend className={legendClass} id={`${baseId}-availability`}>Availability</legend>
          <SegmentedControl
            label="Availability"
            labelledBy={`${baseId}-availability`}
            fullWidth
            value={currentType}
            resetKey={searchKey}
            onChange={(value) => navigateWith({ type: value })}
            options={[
              { value: "", label: "All" },
              { value: "IN_STOCK", label: "In stock" },
              { value: "MADE_TO_ORDER", label: "Made to order" },
            ]}
          />
        </fieldset>

        {/* Location is a defining discovery feature, so it stays near the
            top instead of below every commercial refinement. */}
        <fieldset>
          <legend className={legendClass}>Near location</legend>
          <div className="space-y-2.5">
            {!hasLocation ? (
              <button type="button" onClick={detectLocation} disabled={locating} className="btn btn-sm btn-secondary">
                {locating ? "Finding you…" : "Use my location"}
              </button>
            ) : (
              <div ref={distanceGroupRef} className="flex flex-wrap gap-2" role="group" aria-label="Distance from you">
                {RADIUS_OPTIONS.map((miles) => (
                  <Link
                    key={miles}
                    href={hrefWith({ lat, lng, radius: miles })}
                    scroll={false}
                    data-filter-changes={JSON.stringify({ lat, lng, radius: miles })}
                    onPointerUp={(event) => event.currentTarget.blur()}
                    onClick={handleFilterLinkClick}
                    aria-current={currentRadius === miles ? "true" : undefined}
                    className={chipClass(currentRadius === miles)}
                  >
                    {miles} mi
                  </Link>
                ))}
                {currentRadius && !RADIUS_OPTIONS.includes(currentRadius) && (
                  <span aria-current="true" className={chipClass(true)}>{currentRadius} mi</span>
                )}
              </div>
            )}
            {hasLocation && !currentRadius && (
              <p className="text-xs text-neutral-600">Pick a distance from you.</p>
            )}
            {hasLocation && currentRadius && (
              <Link href={hrefWith({ lat: null, lng: null, radius: null })} scroll={false} data-filter-changes={JSON.stringify({ lat: null, lng: null, radius: null })} onClick={handleFilterLinkClick} className="inline-block text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
                Any distance
              </Link>
            )}
            {geoError && (
              <div role="alert" className="text-xs text-red-600">
                {geoError}
              </div>
            )}
          </div>
        </fieldset>

        {/* Price */}
        <fieldset>
          <legend className={legendClass}>Price (USD)</legend>
          <form
            ref={priceFormRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              applyPrice();
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor={`${baseId}-min`} className="sr-only">Minimum price</label>
            <input
              ref={minRef}
              id={`${baseId}-min`}
              name="min"
              type="text"
              inputMode="decimal"
              value={minInput}
              onChange={(event) => setMinInput(event.target.value)}
              placeholder="$ Min"
              onBlur={onPriceBlur}
              aria-invalid={pendingMin === null || undefined}
              aria-describedby={priceError ? `${baseId}-price-error` : undefined}
              className="h-11 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 text-sm"
            />
            <span className="shrink-0 text-neutral-400" aria-hidden="true">–</span>
            <label htmlFor={`${baseId}-max`} className="sr-only">Maximum price</label>
            <input
              ref={maxRef}
              id={`${baseId}-max`}
              name="max"
              type="text"
              inputMode="decimal"
              value={maxInput}
              onChange={(event) => setMaxInput(event.target.value)}
              placeholder="$ Max"
              onBlur={onPriceBlur}
              aria-invalid={pendingMax === null || undefined}
              aria-describedby={priceError ? `${baseId}-price-error` : undefined}
              className="h-11 w-full min-w-0 rounded-xl border border-stone-300 bg-white px-3 text-sm"
            />
            {/* Lets Enter submit from either field; not a Tab stop. */}
            <button type="submit" tabIndex={-1} className="sr-only">Apply price</button>
          </form>
          {priceError && (
            <p id={`${baseId}-price-error`} role="alert" className="mt-1.5 text-xs text-red-700">
              {priceError}
            </p>
          )}
        </fieldset>

        {/* Ships within */}
        <fieldset>
          <legend className={legendClass}>Ships within</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" onPointerUp={(event) => event.currentTarget.blur()} onClick={() => { setPendingShips(""); navigateWith({ ships: null }); }} aria-pressed={!pendingShips} className={chipClass(!pendingShips)}>
              Any time
            </button>
            {SHIPS_WITHIN_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={() => { setPendingShips(days); navigateWith({ ships: days }); }}
                aria-pressed={pendingShips === days}
                className={chipClass(pendingShips === days)}
              >
                {days} days
              </button>
            ))}
            {pendingShips && !SHIPS_WITHIN_OPTIONS.includes(pendingShips) && (
              <span aria-current="true" className={chipClass(true)}>{pendingShips} days</span>
            )}
          </div>
        </fieldset>

        {/* Shop rating */}
        <fieldset>
          <legend className={legendClass}>Shop rating</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" onPointerUp={(event) => event.currentTarget.blur()} onClick={() => { setPendingRating(""); navigateWith({ rating: null }); }} aria-pressed={!pendingRating} className={chipClass(!pendingRating)}>
              Any
            </button>
            {RATING_OPTIONS.map((stars) => (
              <button
                key={stars}
                type="button"
                onPointerUp={(event) => event.currentTarget.blur()}
                onClick={() => { setPendingRating(stars); navigateWith({ rating: stars }); }}
                aria-label={`${stars} stars and up`}
                aria-pressed={pendingRating === stars}
                className={chipClass(pendingRating === stars)}
              >
                {stars}★ and up
              </button>
            ))}
          </div>
        </fieldset>

        {/* Popular tags */}
        {popularTags.length > 0 && (
          <fieldset>
            <legend className={legendClass}>Popular tags</legend>
            <div className="flex flex-wrap gap-2">
              {Array.from(new Set([...selectedTags, ...popularTags])).map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <Link
                    key={tag}
                    href={tagToggleHref(tag)}
                    scroll={false}
                    data-filter-tag={tag}
                    onPointerUp={(event) => event.currentTarget.blur()}
                    onClick={handleTagLinkClick}
                    aria-current={active ? "true" : undefined}
                    className={chipClass(active)}
                  >
                    #{tag}
                  </Link>
                );
              })}
            </div>
          </fieldset>
        )}

        <Link
          href={q ? `/browse?q=${encodeURIComponent(q)}` : "/browse"}
          scroll={false}
          onClick={scrollResultsToTop}
          className="inline-flex min-h-11 items-center text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
        >
          Reset filters
        </Link>
      </div>
    </aside>
  );
}
