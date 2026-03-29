// src/components/MapCard.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import type * as LeafletLib from "leaflet";

type Props = {
  lat: number;
  lng: number;
  label?: string;
  radiusMeters?: number | null;
  /** Show a pin even when a radius is present (defaults to false for privacy) */
  showPinWithRadius?: boolean;
  /** Use a stable seed so jitter doesn't jump (e.g., seller.id) */
  seed?: string | null;
};

function ensureLeafletCss() {
  if (typeof document === "undefined") return;
  if (!document.querySelector('link[data-leaflet="css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.setAttribute("data-leaflet", "css");
    document.head.appendChild(link);
  }
}

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

// small jitter so the circle center isn’t the exact address
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

// consistent SVG pin icon (red)
function makePinIcon(L: typeof LeafletLib, color = "#ef4444", size = 30) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
    </svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size], // tip at bottom center
    popupAnchor: [0, -size],
  });
}

export default function MapCard({
  lat,
  lng,
  label,
  radiusMeters = null,
  showPinWithRadius = false,
  seed = null,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletLib.Map | null>(null);

  // Force a fresh DOM node (avoids “already initialized” in dev/HMR)
  const mapKey = useMemo(
    () => `${seed ?? "s"}-${lat.toFixed(5)}-${lng.toFixed(5)}-${radiusMeters ?? 0}-${showPinWithRadius}`,
    [lat, lng, radiusMeters, showPinWithRadius, seed]
  );

  useEffect(() => {
    (async () => {
      ensureLeafletCss();
      const leaflet = await import("leaflet");
      const L = ((leaflet as unknown) as { default?: typeof LeafletLib }).default ?? (leaflet as unknown as typeof LeafletLib);

      const el = ref.current!;
      if (!el) return;

      // Clean up any previous instance on this element
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
      // Extra safety: clear any leftovers on the element
      (el as HTMLDivElement & { _leaflet_id?: number })._leaflet_id = undefined;
      el.innerHTML = "";

      // choose a center: jittered if we have a radius
      const center =
        radiusMeters && radiusMeters > 0
          ? jitterAround(lat, lng, radiusMeters, seed ?? `${lat},${lng}`)
          : { lat, lng };

      const map = L.map(el, {
        center: [center.lat, center.lng],
        zoom: radiusMeters && radiusMeters > 0 ? 12 : 13,
        scrollWheelZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      // draw circle if any
      if (radiusMeters && radiusMeters > 0) {
        L.circle([center.lat, center.lng], {
          radius: radiusMeters,
          color: "#2563eb",
          weight: 2,
          fillColor: "#60a5fa",
          fillOpacity: 0.15,
        }).addTo(map);
      }

      // show a pin:
      // - always when no radius
      // - only when showPinWithRadius=true if there is a radius
      if (!radiusMeters || radiusMeters <= 0 || showPinWithRadius) {
        const icon = makePinIcon(L);
        const m = L.marker([center.lat, center.lng], { icon, title: label ?? "" }).addTo(map);
        if (label) m.bindPopup(label);
      }

      // fix size after render
      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      try {
        if (mapRef.current) mapRef.current.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [mapKey, lat, lng, label, radiusMeters, showPinWithRadius, seed]);

  return (
    <div
      key={mapKey}
      ref={ref}
      className="rounded-xl overflow-hidden border"
      style={{ height: 320, width: "100%" }}
    />
  );
}






