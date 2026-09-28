// src/components/MapCard.tsx
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import * as maplibregl from "@/lib/maplibreClient";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";

type Props = {
  /** Coordinates already reduced to their public precision by the server. */
  displayLat: number;
  displayLng: number;
  label?: string;
  radiusMeters?: number | null;
  /** Show a pin even when a radius is present (defaults to false for privacy) */
  showPinWithRadius?: boolean;
  className?: string;
};

export default function MapCard({
  displayLat: lat,
  displayLng: lng,
  label,
  radiusMeters,
  showPinWithRadius = false,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const privacyRadiusMeters = typeof radiusMeters === "number" && radiusMeters > 0 ? radiusMeters : null;
  const hasPrivacyRadius = privacyRadiusMeters !== null;

  useEffect(() => {
    if (!containerRef.current) return;
    setMapUnavailable(false);

    if (!maplibreSupported(maplibregl)) {
      setMapUnavailable(true);
      return;
    }

    const displayLat = lat;
    const displayLng = lng;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [displayLng, displayLat],
        zoom: privacyRadiusMeters ? Math.max(9, 14 - Math.log2(privacyRadiusMeters / 100)) : 13,
        // interactive defaults to true — pan and zoom enabled
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    map.scrollZoom.disable(); // prevent scroll hijacking on page
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      if (hasPrivacyRadius) {
        const numPoints = 64;
        const coords: [number, number][] = [];
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * 2 * Math.PI;
          const dx = (privacyRadiusMeters / 111320) * Math.cos(angle);
          const dy = (privacyRadiusMeters / (111320 * Math.cos((displayLat * Math.PI) / 180))) * Math.sin(angle);
          coords.push([displayLng + dy, displayLat + dx]);
        }
        coords.push(coords[0]);

        map.addSource("radius", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [coords] },
            properties: {},
          },
        });

        map.addLayer({
          id: "radius-fill",
          type: "fill",
          source: "radius",
          paint: { "fill-color": "#1C1C1A", "fill-opacity": 0.08 },
        });

        map.addLayer({
          id: "radius-border",
          type: "line",
          source: "radius",
          paint: { "line-color": "#1C1C1A", "line-width": 1.5, "line-opacity": 0.4 },
        });
      }

      if (!hasPrivacyRadius || showPinWithRadius) {
        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([displayLng, displayLat]);
        if (label) {
          marker.setPopup(new maplibregl.Popup({ offset: 25 }).setText(label));
        }
        marker.addTo(map);
      }
    });

    return () => map.remove();
  }, [lat, lng, privacyRadiusMeters, hasPrivacyRadius, showPinWithRadius, label]);

  const resolvedClassName = className ?? "h-48 w-full rounded-xl border border-neutral-200 overflow-hidden";
  if (mapUnavailable) {
    return (
      <MapFallback
        className={resolvedClassName}
        lat={hasPrivacyRadius ? null : lat}
        lng={hasPrivacyRadius ? null : lng}
        message={
          hasPrivacyRadius
            ? "Map preview is unavailable because WebGL is disabled or unsupported. Exact pickup details are private."
            : "Map preview is unavailable because WebGL is disabled or unsupported."
        }
      />
    );
  }

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={label ? `Map showing ${label}` : "Map preview"}
      className={resolvedClassName}
    />
  );
}
