// src/components/MakersMapSection.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Navigation } from "@/components/icons";

// Lazy-load the map component — maplibre-gl is ~1MB JS. Rendering it only
// when this below-the-fold section approaches the viewport keeps that bundle
// from competing with the homepage hero and header during first paint.
const AllSellersMap = dynamic(() => import("./AllSellersMap"), {
  ssr: false,
  loading: () => (
    <div className="h-full w-full rounded-lg bg-[#EFEAE0] animate-pulse" />
  ),
});

type Point = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
};

export default function MakersMapSection({
  points,
  heading,
  subheading,
  headingClassName,
  compact = false,
}: {
  points: Point[];
  heading?: string;
  subheading?: string;
  headingClassName?: string;
  compact?: boolean;
}) {
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  // The location icon spins while the browser looks up the position.
  const [locating, setLocating] = useState(false);
  const router = useRouter();

  const locatingRef = useRef(false);
  const locatingResetRef = useRef<number | null>(null);
  const stopLocating = () => {
    locatingRef.current = false;
    setLocating(false);
    if (locatingResetRef.current !== null) {
      window.clearTimeout(locatingResetRef.current);
      locatingResetRef.current = null;
    }
  };
  useEffect(() => () => {
    if (locatingResetRef.current !== null) window.clearTimeout(locatingResetRef.current);
  }, []);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (!("IntersectionObserver" in window)) {
      setMapReady(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        setMapReady(true);
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const onUseMyLocation = () => {
    // One lookup at a time; a second click would push /map twice.
    if (locatingRef.current) return;
    setGeoErr(null);
    if (!navigator.geolocation) {
      setGeoErr("Location not available in this browser.");
      return;
    }
    locatingRef.current = true;
    setLocating(true);
    // The browser's timeout only starts after permission is granted, so a
    // dismissed or ignored prompt would leave the spinner going forever.
    locatingResetRef.current = window.setTimeout(stopLocating, 15000);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = new URL("/map", window.location.origin);
        url.searchParams.set("near", `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`);
        url.searchParams.set("zoom", "12");
        router.push(url.toString());
      },
      (err) => {
        stopLocating();
        setGeoErr(err.message || "Could not get location.");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <section ref={sectionRef} className="min-w-0">
      <div className={`flex min-w-0 flex-col lg:flex-row lg:items-center ${compact ? "gap-5 lg:gap-8" : "gap-6 lg:gap-10"}`}>
        <div className="min-w-0 lg:w-[34%] lg:pb-8">
          <h2 className={`text-2xl font-semibold ${headingClassName ?? ""}`}>{heading ?? "Find local artisans near you"}</h2>
          <p className="mt-2 text-neutral-600">
            {subheading ?? "Explore makers in your area. Share your location to see who’s nearby—or browse the full map."}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={onUseMyLocation}
              aria-busy={locating || undefined}
              className="btn btn-primary min-w-0 px-3 text-sm sm:px-4"
            >
              <Navigation size={15} className={`shrink-0${locating ? " motion-safe:animate-spin" : ""}`} />
              <span className="truncate">
                {locating ? "Finding…" : <><span className="sm:hidden">Use location</span><span className="hidden sm:inline">Use my location</span></>}
              </span>
            </button>
            <a
              href="/map"
              className="btn btn-secondary min-w-0 px-3 text-sm sm:px-4"
            >
              <span className="sm:hidden">Full map</span><span className="hidden sm:inline">Explore the full map</span>
            </a>
          </div>
          {geoErr && <div role="alert" className="mt-2 text-xs text-red-600">{geoErr}</div>}
        </div>

        <div className={`${compact ? "h-[300px] sm:h-[320px] lg:h-[340px]" : "h-[420px]"} w-full min-w-0 lg:flex-1 overflow-hidden rounded-lg shadow-sm ring-1 ring-stone-200/70`}>
          {mapReady ? (
            <AllSellersMap embedded points={points} initialZoom={3} mobileInitialZoom={2.05} height="100%" />
          ) : (
            <div className="h-full w-full rounded-lg bg-[#EFEAE0] animate-pulse motion-reduce:animate-none" aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
