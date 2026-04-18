// src/components/MapCard.tsx
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

// --- deterministic PRNG so jitter stays stable per seed ---
function xmur3(str: string) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededRand(seed: string) {
  const h = xmur3(seed);
  return mulberry32(h());
}

// small jitter so the circle center isn't the exact address
function jitterAround(lat: number, lng: number, radiusMeters: number, seed?: string | null) {
  const R = 111_111; // m per degree approx
  const max = Math.min(radiusMeters * 0.4, 800); // cap jitter at 800m

  const rnd = seed ? seededRand(seed) : Math.random;
  const r = (rnd() * max) / R;
  const t = rnd() * Math.PI * 2;

  const dLat = r * Math.sin(t);
  const dLon = (r * Math.cos(t)) / Math.cos((lat * Math.PI) / 180);
  return { lat: lat + dLat, lng: lng + dLon };
}

type Props = {
  lat: number;
  lng: number;
  label?: string;
  radiusMeters?: number | null;
  /** Show a pin even when a radius is present (defaults to false for privacy) */
  showPinWithRadius?: boolean;
  /** Use a stable seed so jitter doesn't jump (e.g., seller.id) */
  seed?: string | null;
  className?: string;
};

export default function MapCard({
  lat,
  lng,
  label,
  radiusMeters,
  showPinWithRadius = false,
  seed,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let displayLat = lat;
    let displayLng = lng;
    if (radiusMeters && radiusMeters > 0) {
      const jittered = jitterAround(lat, lng, radiusMeters, seed);
      displayLat = jittered.lat;
      displayLng = jittered.lng;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [displayLng, displayLat],
      zoom: radiusMeters ? Math.max(9, 14 - Math.log2(radiusMeters / 100)) : 13,
      // interactive defaults to true — pan and zoom enabled
    });

    map.scrollZoom.disable(); // prevent scroll hijacking on page
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      if (radiusMeters && radiusMeters > 0) {
        const numPoints = 64;
        const coords: [number, number][] = [];
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * 2 * Math.PI;
          const dx = (radiusMeters / 111320) * Math.cos(angle);
          const dy = (radiusMeters / (111320 * Math.cos((displayLat * Math.PI) / 180))) * Math.sin(angle);
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

      if (!radiusMeters || showPinWithRadius) {
        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([displayLng, displayLat]);
        if (label) {
          marker.setPopup(new maplibregl.Popup({ offset: 25 }).setText(label));
        }
        marker.addTo(map);
      }
    });

    return () => map.remove();
  }, [lat, lng, radiusMeters, showPinWithRadius, seed]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-48 w-full rounded-xl border overflow-hidden"}
    />
  );
}
