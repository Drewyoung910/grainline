// src/components/AllSellersMap.tsx
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { publicSellerPath } from "@/lib/publicPaths";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";
import MakerMapCard, { type MakerMapCardCache } from "@/components/MakerMapCard";

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
  mobileInitialZoom?: number;
  height?: number;
};

export default function AllSellersMap({
  points,
  initialCenter,
  initialZoom = 3,
  mobileInitialZoom,
  height = 520,
}: Props) {
  const summaryId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardCache = useMemo<MakerMapCardCache>(() => new Map(), []);
  const [mapUnavailable, setMapUnavailable] = useState(false);
  // Pin selected for the maker-card overlay (rendered OUTSIDE maplibre,
  // pinned to the map container corner, so it can never be clipped).
  const [selectedPin, setSelectedPin] = useState<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapUnavailable(false);
    if (!maplibreSupported(maplibregl)) {
      setMapUnavailable(true);
      return;
    }

    const center: [number, number] = initialCenter
      ? [initialCenter.lng, initialCenter.lat]
      : [-96, 38];
    const isNarrowViewport = window.matchMedia("(max-width: 640px)").matches;
    const resolvedInitialZoom =
      !initialCenter && isNarrowViewport && mobileInitialZoom != null
        ? mobileInitialZoom
        : initialZoom;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center,
        zoom: resolvedInitialZoom,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      map.addSource("sellers", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: points.map((p) => ({
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
            properties: { id: p.id, name: p.name, city: p.city, state: p.state },
          })),
        },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "sellers",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#1C1C1A",
          "circle-radius": ["step", ["get", "point_count"], 20, 10, 30, 30, 40],
        },
      });

      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "sellers",
        filter: ["has", "point_count"],
        layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
        paint: { "text-color": "#ffffff" },
      });

      // v5 Promise API — NOT callback style
      map.on("click", "clusters", async (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
        if (!features.length) return;
        const clusterId = features[0].properties?.cluster_id as number;
        const source = map.getSource("sellers") as maplibregl.GeoJSONSource;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
          map.easeTo({ center: coords, zoom });
        } catch {
          // ignore
        }
      });

      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
    });

    // Clicking the map background (not a pin) dismisses the maker card.
    map.on("click", () => setSelectedPin(null));

    const markers: maplibregl.Marker[] = [];

    function updateMarkers() {
      markers.forEach(m => m.remove());
      markers.length = 0;

      if (!map.isSourceLoaded("sellers")) return;

      const features = map.querySourceFeatures("sellers", {
        filter: ["!", ["has", "point_count"]],
      });

      // Deduplicate by feature id since querySourceFeatures can return duplicates across tiles
      const seen = new Set<string>();
      for (const feature of features) {
        const id = feature.properties?.id as string;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
        const props = feature.properties as Record<string, unknown> | null;
        const nameText = typeof props?.name === "string" ? props.name : "";
        const cityText = typeof props?.city === "string" ? props.city : null;
        const stateText = typeof props?.state === "string" ? props.state : null;

        // No maplibre popup — pin click opens the MakerMapCard overlay,
        // which lives outside the map canvas and can't be clipped by it.
        const selectPin = () => setSelectedPin({ id, name: nameText, city: cityText, state: stateText });
        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat(coords)
          .addTo(map);
        const markerEl = marker.getElement();
        markerEl.style.cursor = "pointer";
        markerEl.setAttribute("role", "button");
        markerEl.setAttribute("tabindex", "0");
        markerEl.setAttribute("aria-label", `Show maker details for ${nameText || "maker"}`);
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
    }

    // Update markers when source data loads or viewport changes
    map.on("sourcedata", (e) => {
      if (e.sourceId === "sellers" && map.isSourceLoaded("sellers")) {
        updateMarkers();
      }
    });
    map.on("moveend", updateMarkers);

    // Watch the container for size changes and force the map to resize.
    // This fixes the "blank map on first paint" race where the container's
    // layout isn't fully settled when Maplibre initializes.
    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch { /* map may be already removed */ }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    // Also kick the map after the next frame and again after a beat, so even
    // if ResizeObserver doesn't fire (no size change), the canvas gets a
    // forced re-render after parent layout finishes.
    const raf = requestAnimationFrame(() => {
      try { map.resize(); } catch { /* ignore */ }
    });
    const settle = setTimeout(() => {
      try { map.resize(); } catch { /* ignore */ }
    }, 250);

    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(settle);
      markers.forEach(m => m.remove());
      map.remove();
    };
  }, [points, initialCenter, initialZoom, mobileInitialZoom]);

  if (mapUnavailable) {
    return (
      <MapFallback
        className="w-full rounded-xl border border-neutral-200"
        message="Map is unavailable because WebGL is disabled or unsupported."
        lat={initialCenter?.lat ?? points[0]?.lat}
        lng={initialCenter?.lng ?? points[0]?.lng}
        links={points.slice(0, 8).map((point) => ({
          href: publicSellerPath(point.id, point.name),
          label: point.name,
        }))}
      />
    );
  }

  return (
    <>
      <div className="relative">
        <div
          ref={containerRef}
          role="application"
          aria-label="Map of Grainline makers"
          aria-describedby={summaryId}
          style={{ height, width: "100%" }}
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
      <ul id={summaryId} className="sr-only">
        {points.slice(0, 12).map((point) => (
          <li key={point.id}>
            {point.name}
            {[point.city, point.state].filter(Boolean).length > 0
              ? ` in ${[point.city, point.state].filter(Boolean).join(", ")}`
              : ""}
          </li>
        ))}
      </ul>
    </>
  );
}
