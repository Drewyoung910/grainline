"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { publicSellerPath } from "@/lib/publicPaths";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";

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
  const [mapUnavailable, setMapUnavailable] = useState(false);

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

    map.on("load", () => {
      for (const seller of sellers) {
        const popupContent = document.createElement("div");

        const name = document.createElement("div");
        name.className = "text-sm font-medium";
        name.textContent = seller.name;
        popupContent.appendChild(name);

        if (seller.city) {
          const location = document.createElement("div");
          location.className = "text-xs text-neutral-500";
          location.textContent = `${seller.city}${seller.state ? `, ${seller.state}` : ""}`;
          popupContent.appendChild(location);
        }

        const link = document.createElement("a");
        link.href = publicSellerPath(seller.id, seller.name);
        link.className = "text-xs text-amber-700 underline mt-1 block";
        link.textContent = "View shop";
        popupContent.appendChild(link);

        const popup = new maplibregl.Popup({ offset: 25 }).setDOMContent(popupContent);

        new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([seller.lng, seller.lat])
          .setPopup(popup)
          .addTo(map);
      }
    });

    return () => map.remove();
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
    <div className="rounded-xl overflow-hidden border">
      <div ref={containerRef} style={{ height: 520, width: "100%" }} />
    </div>
  );
}
