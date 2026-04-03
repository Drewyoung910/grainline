"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

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

  const center: [number, number] = sellers.length
    ? [sellers[0].lng, sellers[0].lat]
    : [-98.35, 39.5];

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center,
      zoom: sellers.length ? 8 : 4,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      for (const seller of sellers) {
        const popup = new maplibregl.Popup({ offset: 25 }).setHTML(
          `<div class="text-sm font-medium">${seller.name}</div>
           ${seller.city ? `<div class="text-xs text-neutral-500">${seller.city}${seller.state ? `, ${seller.state}` : ""}</div>` : ""}
           <a href="/seller/${seller.id}" class="text-xs text-amber-700 underline mt-1 block">View shop →</a>`
        );

        new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([seller.lng, seller.lat])
          .setPopup(popup)
          .addTo(map);
      }
    });

    return () => map.remove();
  }, [sellers]);

  return (
    <div className="rounded-xl overflow-hidden border">
      <div ref={containerRef} style={{ height: 520, width: "100%" }} />
    </div>
  );
}
