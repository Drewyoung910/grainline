"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import { normalizeTags } from "@/lib/tags";
import SegmentedControl from "@/components/SegmentedControl";

// Every change applies at once and glides the page back to the top of the
// results (the motion study's floating filter column).
function scrollResultsToTop() {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
}

const SHIPS_WITHIN_OPTIONS = ["3", "7", "14", "30"];
const RATING_OPTIONS = ["4", "3", "2"];
const RADIUS_OPTIONS = ["10", "25", "50", "100"];

const legendClass = "mb-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-neutral-500";

function chipClass(active: boolean) {
  return `inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-[background-color,border-color,color,scale] duration-200 motion-safe:active:scale-95 ${
    active
      ? "border-[#2C1F1A] bg-[#2C1F1A] text-[#FBF8F3]"
      : "border-[#2C1F1A]/25 bg-white text-neutral-800 hover:border-[#2C1F1A]"
  }`;
}

export default function FilterSidebar({ popularTags }: { popularTags: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const baseId = React.useId();
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

  const [geo, setGeo] = React.useState<{ lat: string; lng: string } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [geoError, setGeoError] = React.useState<string | null>(null);
  const lat = geo?.lat ?? urlLat;
  const lng = geo?.lng ?? urlLng;

  function hrefWith(changes: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
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

  function tagToggleHref(tag: string) {
    const params = new URLSearchParams(searchParams.toString());
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

  // Price applies on Enter or when a field is left with a new value.
  const priceFormRef = React.useRef<HTMLFormElement>(null);
  const applyPrice = () => {
    const form = priceFormRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    const min = String(data.get("min") ?? "").trim();
    const max = String(data.get("max") ?? "").trim();
    if (min === currentMin && max === currentMax) return;
    go(hrefWith({ min, max }));
  };

  const linkProps = { scroll: false, onClick: scrollResultsToTop } as const;
  const hasLocation = Boolean(lat && lng);

  return (
    <aside aria-label="Filters" className="hidden md:block w-56 lg:w-60 shrink-0">
      <div className="max-h-[calc(100dvh-var(--site-header-h)-2rem)] space-y-7 overflow-y-auto overscroll-contain pb-6 pr-2 text-sm [scrollbar-width:thin]">
        {/* Category */}
        <nav aria-labelledby={`${baseId}-category`}>
          <h2 id={`${baseId}-category`} className={legendClass}>Category</h2>
          <ul className="space-y-0.5">
            {[{ value: "", label: "All categories" }, ...CATEGORY_VALUES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))].map(
              ({ value, label }) => {
                const active = currentCategory === value;
                return (
                  <li key={value || "all"}>
                    <Link
                      href={hrefWith({ category: value })}
                      {...linkProps}
                      aria-current={active ? "true" : undefined}
                      className={`flex h-[38px] items-center rounded-[10px] px-3 text-[15px] transition-[background-color,box-shadow] duration-150 ${
                        active
                          ? "bg-white font-medium shadow-[0_1px_0_rgba(44,31,26,0.12),0_6px_16px_-12px_rgba(0,0,0,0.4)]"
                          : "text-neutral-700 hover:bg-[#EFEAE0]"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              },
            )}
          </ul>
        </nav>

        {/* Availability */}
        <fieldset>
          <legend className={legendClass}>Availability</legend>
          <SegmentedControl
            label="Availability"
            fullWidth
            value={currentType}
            onChange={(value) => go(hrefWith({ type: value }))}
            options={[
              { value: "", label: "All" },
              { value: "IN_STOCK", label: "Ready" },
              { value: "MADE_TO_ORDER", label: "Made to order" },
            ]}
          />
        </fieldset>

        {/* Price */}
        <fieldset>
          <legend className={legendClass}>Price (USD)</legend>
          <form
            key={`${currentMin}|${currentMax}`}
            ref={priceFormRef}
            onSubmit={(event) => {
              event.preventDefault();
              applyPrice();
            }}
            className="flex items-center gap-2"
          >
            <label htmlFor={`${baseId}-min`} className="sr-only">Minimum price</label>
            <input
              id={`${baseId}-min`}
              name="min"
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              defaultValue={currentMin}
              placeholder="$ Min"
              onBlur={applyPrice}
              className="h-11 w-full min-w-0 rounded-[10px] border border-[#2C1F1A]/25 bg-white px-3 text-sm"
            />
            <span className="shrink-0 text-neutral-400" aria-hidden="true">–</span>
            <label htmlFor={`${baseId}-max`} className="sr-only">Maximum price</label>
            <input
              id={`${baseId}-max`}
              name="max"
              type="text"
              inputMode="decimal"
              pattern={"\\d+(\\.\\d{1,2})?|\\.\\d{1,2}"}
              defaultValue={currentMax}
              placeholder="$ Max"
              onBlur={applyPrice}
              className="h-11 w-full min-w-0 rounded-[10px] border border-[#2C1F1A]/25 bg-white px-3 text-sm"
            />
            {/* Lets Enter submit from either field. */}
            <button type="submit" className="sr-only">Apply price</button>
          </form>
        </fieldset>

        {/* Ships within */}
        <fieldset>
          <legend className={legendClass}>Ships within</legend>
          <div className="flex flex-wrap gap-2">
            <Link href={hrefWith({ ships: null })} {...linkProps} aria-current={!currentShips ? "true" : undefined} className={chipClass(!currentShips)}>
              Any time
            </Link>
            {SHIPS_WITHIN_OPTIONS.map((days) => (
              <Link
                key={days}
                href={hrefWith({ ships: days })}
                {...linkProps}
                aria-current={currentShips === days ? "true" : undefined}
                className={chipClass(currentShips === days)}
              >
                {days} days
              </Link>
            ))}
            {currentShips && !SHIPS_WITHIN_OPTIONS.includes(currentShips) && (
              <span aria-current="true" className={chipClass(true)}>{currentShips} days</span>
            )}
          </div>
        </fieldset>

        {/* Shop rating */}
        <fieldset>
          <legend className={legendClass}>Shop rating</legend>
          <div className="flex flex-wrap gap-2">
            <Link href={hrefWith({ rating: null })} {...linkProps} aria-current={!currentRating ? "true" : undefined} className={chipClass(!currentRating)}>
              Any
            </Link>
            {RATING_OPTIONS.map((stars) => (
              <Link
                key={stars}
                href={hrefWith({ rating: stars })}
                {...linkProps}
                aria-label={`${stars} stars and up`}
                aria-current={currentRating === stars ? "true" : undefined}
                className={chipClass(currentRating === stars)}
              >
                {stars}★ and up
              </Link>
            ))}
          </div>
        </fieldset>

        {/* Near location */}
        <fieldset>
          <legend className={legendClass}>Near location</legend>
          <div className="space-y-2.5">
            {!hasLocation ? (
              <button type="button" onClick={detectLocation} disabled={locating} className="btn btn-sm btn-secondary">
                {locating ? "Finding you…" : "Use my location"}
              </button>
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Distance from you">
                {RADIUS_OPTIONS.map((miles) => (
                  <Link
                    key={miles}
                    href={hrefWith({ lat, lng, radius: miles })}
                    {...linkProps}
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
            {hasLocation && currentRadius && (
              <Link href={hrefWith({ lat: null, lng: null, radius: null })} {...linkProps} className="inline-block text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800">
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
                    {...linkProps}
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
          {...linkProps}
          className="inline-flex min-h-11 items-center text-sm text-neutral-500 underline underline-offset-2 hover:text-neutral-800"
        >
          Reset filters
        </Link>
      </div>
    </aside>
  );
}
