// src/components/MakersMapSection.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";

// Lazy-load the map component — maplibre-gl is ~1MB JS.
// Deferred until MakersMapSection hydrates client-side.
const AllSellersMap = dynamic(() => import("./AllSellersMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-stone-100 animate-pulse rounded-2xl" />
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
}: {
  points: Point[];
  heading?: string;
  subheading?: string;
  headingClassName?: string;
}) {
  const [geoErr, setGeoErr] = useState<string | null>(null);
  const router = useRouter();

  const onUseMyLocation = () => {
    setGeoErr(null);
    if (!navigator.geolocation) {
      setGeoErr("Location not available in this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const url = new URL("/map", window.location.origin);
        url.searchParams.set("near", `${coords.latitude.toFixed(6)},${coords.longitude.toFixed(6)}`);
        url.searchParams.set("zoom", "12");
        router.push(url.toString());
      },
      (err) => setGeoErr(err.message || "Could not get location."),
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  return (
    <section className="rounded-2xl bg-stone-50 overflow-hidden">
      <div className="p-6 sm:p-8 flex flex-col lg:flex-row gap-6 lg:gap-10">
        <div className="lg:w-[38%]">
          <h2 className={`text-2xl font-semibold ${headingClassName ?? ""}`}>{heading ?? "Find local artisans near you"}</h2>
          <p className="mt-2 text-neutral-600">
            {subheading ?? "Explore makers in your area. Share your location to see who’s nearby—or browse the full map."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={onUseMyLocation}
              className="inline-flex items-center rounded-md bg-amber-600 text-white px-4 py-2 text-sm font-medium hover:bg-amber-700 transition-colors"
            >
              Use my location
            </button>
            <a
              href="/map"
              className="inline-flex items-center rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50 transition-colors"
            >
              Open Makers Map
            </a>
          </div>
          {geoErr && <div className="mt-2 text-xs text-red-600">{geoErr}</div>}
        </div>

        <div className="flex-1 min-h-[280px] rounded-2xl overflow-hidden">
          <AllSellersMap points={points} initialZoom={3} height={280} />
        </div>
      </div>
    </section>
  );
}
