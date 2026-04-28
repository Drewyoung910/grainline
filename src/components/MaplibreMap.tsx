"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";

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
  const [mapUnavailable, setMapUnavailable] = useState(false);

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
        center: [lng, lat],
        zoom,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    new maplibregl.Marker({ color: "#1C1C1A" })
      .setLngLat([lng, lat])
      .addTo(map);

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    return () => map.remove();
  }, [lat, lng, zoom]);

  if (mapUnavailable) {
    return (
      <MapFallback
        className={className}
        lat={lat}
        lng={lng}
        message="Map is unavailable because WebGL is disabled or unsupported."
      />
    );
  }

  return <div ref={containerRef} className={className} />;
}
