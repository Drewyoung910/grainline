// src/components/AllSellersMap.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import type * as LeafletLib from "leaflet";

type Point = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
};

type Props = {
  points: Point[];
  initialCenter?: { lat: number; lng: number } | null;
  initialZoom?: number;
  height?: number;
};

function ensureCssOnce(href: string, key: string) {
  if (typeof document === "undefined") return;
  if (!document.querySelector(`link[data-key="${key}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute("data-key", key);
    document.head.appendChild(link);
  }
}
function ensureLeafletCss() {
  ensureCssOnce("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "leaflet-css");
}
function ensureClusterCss() {
  ensureCssOnce(
    "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css",
    "cluster-css-1"
  );
  ensureCssOnce(
    "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
    "cluster-css-2"
  );
}
function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (typeof document === "undefined") return resolve();
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.body.appendChild(s);
  });
}
function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// same inline SVG pin used everywhere
function makePinIcon(L: typeof LeafletLib, color = "#ef4444", size = 30) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${color}">
      <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>
    </svg>`
  );
  return L.icon({
    iconUrl: `data:image/svg+xml;charset=UTF-8,${svg}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size],
    popupAnchor: [0, -size],
  });
}

export default function AllSellersMap({
  points,
  initialCenter,
  initialZoom = 4,
  height = 520,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletLib.Map | null>(null);

  // Force fresh DOM node when inputs change
  const mapKey = useMemo(
    () =>
      `all-${points.length}-${initialCenter ? `${initialCenter.lat.toFixed(3)}-${initialCenter.lng.toFixed(3)}` : "auto"}-${initialZoom}`,
    [points.length, initialCenter?.lat, initialCenter?.lng, initialZoom]
  );

  useEffect(() => {
    (async () => {
      ensureLeafletCss();
      ensureClusterCss();
      const leaflet = await import("leaflet");
      const L = ((leaflet as unknown) as { default?: typeof LeafletLib }).default ?? (leaflet as unknown as typeof LeafletLib);

      const el = ref.current!;
      if (!el) return;

      // Clean any previous instance
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
      (el as HTMLDivElement & { _leaflet_id?: number })._leaflet_id = undefined;
      el.innerHTML = "";

      const defaultCenter = initialCenter ?? { lat: 39.5, lng: -98.35 }; // USA-ish
      const map = L.map(el, {
        center: [defaultCenter.lat, defaultCenter.lng],
        zoom: initialZoom,
        scrollWheelZoom: true,
      });
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);

      let clusterOk = false;
      try {
        await loadScript(
          "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js"
        );
        clusterOk = !!(L as unknown as Record<string, unknown>).markerClusterGroup;
      } catch {
        clusterOk = false;
      }

      const icon = makePinIcon(L);
      const bounds = L.latLngBounds([]);

      if (clusterOk) {
        const cluster = (L as unknown as { markerClusterGroup: (opts: Record<string, unknown>) => LeafletLib.LayerGroup }).markerClusterGroup({
          showCoverageOnHover: false,
          maxClusterRadius: 60,
        });
        points.forEach((p) => {
          const ll = L.latLng(p.lat, p.lng);
          bounds.extend(ll);
          const popup = `
            <div style="min-width:180px">
              <div style="font-weight:600;margin-bottom:2px">${esc(p.name)}</div>
              <div style="font-size:12px;color:#555;margin-bottom:6px">${esc(
                [p.city, p.state].filter(Boolean).join(", ") || ""
              )}</div>
              <a href="/seller/${encodeURIComponent(p.id)}" style="font-size:12px;text-decoration:underline">View seller profile →</a>
            </div>`;
          L.marker(ll, { icon }).bindPopup(popup).addTo(cluster);
        });
        cluster.addTo(map);
      } else {
        const layer = L.layerGroup().addTo(map);
        points.forEach((p) => {
          const ll = L.latLng(p.lat, p.lng);
          bounds.extend(ll);
          const popup = `
            <div style="min-width:180px">
              <div style="font-weight:600;margin-bottom:2px">${esc(p.name)}</div>
              <div style="font-size:12px;color:#555;margin-bottom:6px">${esc(
                [p.city, p.state].filter(Boolean).join(", ") || ""
              )}</div>
              <a href="/seller/${encodeURIComponent(p.id)}" style="font-size:12px;text-decoration:underline">View seller profile →</a>
            </div>`;
          L.marker(ll, { icon }).addTo(layer).bindPopup(popup);
        });
      }

      // Fit markers unless a custom center was provided
      if (!initialCenter && points.length) {
        map.fitBounds(bounds, { padding: [30, 30] });
      } else if (initialCenter) {
        map.setView([initialCenter.lat, initialCenter.lng], initialZoom);
      }

      setTimeout(() => map.invalidateSize(), 0);
    })();

    return () => {
      try {
        if (mapRef.current) mapRef.current.remove();
      } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapKey, points]);

  return (
    <div
      key={mapKey}
      ref={ref}
      style={{ height, width: "100%" }}
      className="rounded-xl overflow-hidden border"
    />
  );
}



