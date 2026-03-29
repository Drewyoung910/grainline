// src/components/LeafletMap.tsx
"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export default function LeafletMap({
  lat,
  lng,
  zoom = 12,
  className = "h-64 w-full rounded-xl border overflow-hidden",
}: {
  lat: number;
  lng: number;
  zoom?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;

    const map = L.map(ref.current, { center: [lat, lng], zoom, zoomControl: true, maxZoom: 18, minZoom: 4 });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Use a circle marker to avoid bundling image assets for default pins
    L.circleMarker([lat, lng], {
      radius: 8,
      weight: 2,
      color: "#2563eb",      // border
      fillColor: "#3b82f6",  // fill
      fillOpacity: 0.8,
    }).addTo(map);

    return () => { map.remove(); };
  }, [lat, lng, zoom]);

  return <div ref={ref} className={className} />;
}
