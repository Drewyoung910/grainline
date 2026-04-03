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

      map.addLayer({
        id: "unclustered-point",
        type: "circle",
        source: "sellers",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#1C1C1A",
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
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

      map.on("click", "unclustered-point", (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ["unclustered-point"] });
        if (!features.length) return;
        const props = features[0].properties;
        const coords = (features[0].geometry as GeoJSON.Point).coordinates as [number, number];
        new maplibregl.Popup()
          .setLngLat(coords)
          .setHTML(
            `<div class="text-sm font-medium">${props?.name ?? ""}</div>
             ${props?.city ? `<div class="text-xs text-neutral-500">${props.city}${props.state ? `, ${props.state}` : ""}</div>` : ""}
             <a href="/seller/${props?.id}" class="text-xs text-amber-700 underline mt-1 block">View shop →</a>`
          )
          .addTo(map);
      });

      map.on("mouseenter", "clusters", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "clusters", () => { map.getCanvas().style.cursor = ""; });
      map.on("mouseenter", "unclustered-point", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "unclustered-point", () => { map.getCanvas().style.cursor = ""; });
    });

    return () => map.remove();
  }, [points, initialCenter, initialZoom]);

  return <div ref={containerRef} style={{ height, width: "100%" }} />;
}
