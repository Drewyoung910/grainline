// src/components/AllSellersMap.tsx
"use client";
import "maplibre-gl/dist/maplibre-gl.css";
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
  initialZoom = 3,
  height = 520,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const center: [number, number] = initialCenter
      ? [initialCenter.lng, initialCenter.lat]
      : [-96, 38];

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

    function buildPopupContent(props: Record<string, unknown> | null) {
      const id = typeof props?.id === "string" ? props.id : "";
      const nameText = typeof props?.name === "string" ? props.name : "";
      const cityText = typeof props?.city === "string" ? props.city : "";
      const stateText = typeof props?.state === "string" ? props.state : "";

      const wrapper = document.createElement("div");
      wrapper.style.fontFamily = "inherit";
      wrapper.style.padding = "2px 0";

      const name = document.createElement("div");
      name.style.fontWeight = "600";
      name.style.fontSize = "14px";
      name.style.color = "#1a1a1a";
      name.style.marginBottom = "4px";
      name.textContent = nameText;
      wrapper.appendChild(name);

      if (cityText) {
        const location = document.createElement("div");
        location.style.fontSize = "12px";
        location.style.color = "#6b7280";
        location.style.marginBottom = "6px";
        location.textContent = `${cityText}${stateText ? `, ${stateText}` : ""}`;
        wrapper.appendChild(location);
      }

      const link = document.createElement("a");
      link.href = `/seller/${encodeURIComponent(id)}`;
      link.style.fontSize = "12px";
      link.style.color = "#92400e";
      link.style.textDecoration = "underline";
      link.style.fontWeight = "500";
      link.textContent = "View shop";
      wrapper.appendChild(link);

      return wrapper;
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
          .setDOMContent(buildPopupContent(feature.properties as Record<string, unknown>));

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
