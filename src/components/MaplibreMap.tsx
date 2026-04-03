"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

export default function MaplibreMap({
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
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [lng, lat],
      zoom,
    });

    new maplibregl.Marker({ color: "#1C1C1A" })
      .setLngLat([lng, lat])
      .addTo(map);

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => map.remove();
  }, [lat, lng, zoom]);

  return <div ref={containerRef} className={className} />;
}
