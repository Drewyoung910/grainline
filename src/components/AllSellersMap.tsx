// src/components/AllSellersMap.tsx
"use client";
import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";

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

export default function AllSellersMap({
  points,
  initialCenter,
  initialZoom = 4,
  height = 520,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const center: [number, number] = initialCenter
      ? [initialCenter.lng, initialCenter.lat]
      : [-98.35, 39.5];

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center,
      zoom: initialZoom,
    });

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

    const markers: maplibregl.Marker[] = [];

    function buildPopupHTML(props: Record<string, unknown> | null) {
      return `<div style="font-family:inherit;padding:2px 0;">
    <div style="font-weight:600;font-size:14px;color:#1a1a1a;margin-bottom:4px;">${props?.name ?? ""}</div>
    ${props?.city ? `<div style="font-size:12px;color:#6b7280;margin-bottom:6px;">${props.city}${props.state ? `, ${props.state}` : ""}</div>` : ""}
    <a href="/seller/${props?.id}" style="font-size:12px;color:#92400e;text-decoration:underline;font-weight:500;">View shop →</a>
  </div>`;
    }

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
        const popup = new maplibregl.Popup({ offset: 25, maxWidth: "240px" })
          .setHTML(buildPopupHTML(feature.properties as Record<string, unknown>));

        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat(coords)
          .setPopup(popup)
          .addTo(map);

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

    return () => {
      markers.forEach(m => m.remove());
      map.remove();
    };
  }, [points, initialCenter, initialZoom]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}
