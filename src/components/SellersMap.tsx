"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { publicSellerPath } from "@/lib/publicPaths";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";
import MakerMapCard, { type MakerMapCardCache } from "@/components/MakerMapCard";

type SellerPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string | null;
  state?: string | null;
};

export default function SellersMap({ sellers }: { sellers: SellerPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cardCache = useMemo<MakerMapCardCache>(() => new Map(), []);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  // Pin selected for the maker-card overlay (rendered outside maplibre).
  const [selectedPin, setSelectedPin] = useState<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  } | null>(null);

  const center: [number, number] = useMemo(
    () => (sellers.length ? [sellers[0].lng, sellers[0].lat] : [-98.35, 39.5]),
    [sellers],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    setMapUnavailable(false);
    if (!maplibreSupported(maplibregl)) {
      setMapUnavailable(true);
      return;
    }

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center,
        zoom: sellers.length ? 8 : 4,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const markers: maplibregl.Marker[] = [];

    map.on("load", () => {
      for (const seller of sellers) {
        // No maplibre popup — pin click opens the MakerMapCard overlay,
        // which lives outside the map canvas and can't be clipped by it.
        const selectPin = () =>
          setSelectedPin({
            id: seller.id,
            name: seller.name,
            city: seller.city ?? null,
            state: seller.state ?? null,
          });
        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([seller.lng, seller.lat])
          .addTo(map);
        const markerEl = marker.getElement();
        markerEl.style.cursor = "pointer";
        markerEl.setAttribute("role", "button");
        markerEl.setAttribute("tabindex", "0");
        markerEl.setAttribute("aria-label", `Show maker details for ${seller.name || "maker"}`);
        markerEl.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectPin();
        });
        markerEl.addEventListener("keydown", (ev) => {
          if (ev.key !== "Enter" && ev.key !== " ") return;
          ev.preventDefault();
          ev.stopPropagation();
          selectPin();
        });
        markers.push(marker);
      }
    });

    // Clicking the map background (not a pin) dismisses the maker card.
    map.on("click", () => setSelectedPin(null));

    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [sellers, center]);

  if (mapUnavailable) {
    return (
      <MapFallback
        className="min-h-[320px] w-full rounded-xl border border-neutral-200"
        message="Map is unavailable because WebGL is disabled or unsupported."
        lat={sellers[0]?.lat}
        lng={sellers[0]?.lng}
        links={sellers.slice(0, 6).map((seller) => ({
          href: publicSellerPath(seller.id, seller.name),
          label: seller.name,
        }))}
      />
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden border">
      <div
        ref={containerRef}
        role="application"
        aria-label="Map of Grainline sellers"
        style={{ height: 520, width: "100%" }}
      />
      {selectedPin && (
        <div className="absolute inset-x-3 bottom-3 z-10 sm:inset-x-auto sm:left-3 sm:w-64">
          <MakerMapCard
            key={selectedPin.id}
            sellerId={selectedPin.id}
            fallbackName={selectedPin.name}
            fallbackCity={selectedPin.city}
            fallbackState={selectedPin.state}
            cache={cardCache}
            onClose={() => setSelectedPin(null)}
          />
        </div>
      )}
    </div>
  );
}
