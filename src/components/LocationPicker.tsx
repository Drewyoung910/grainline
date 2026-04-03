"use client";
import { useEffect, useRef, useState, useMemo } from "react";
import maplibregl from "maplibre-gl";

export default function LocationPicker({
  defaultLat,
  defaultLng,
  defaultRadiusMeters,
  onMilesChange,
}: {
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadiusMeters?: number | null;
  onMilesChange?: (miles: number) => void;
}) {
  const start: [number, number] = useMemo(
    () => [defaultLat ?? 30.2672, defaultLng ?? -97.7431],
    [defaultLat, defaultLng]
  );

  const [pos, setPos] = useState<[number, number]>(start);
  const [miles, setMiles] = useState<number>(
    defaultRadiusMeters ? Math.round(defaultRadiusMeters / 1609.34) : 0
  );
  const meters = miles > 0 ? Math.round(miles * 1609.34) : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);

  async function search(q: string) {
    if (!q) return;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (Array.isArray(data) && data[0]) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        setPos([lat, lon]);
        if (mapRef.current) mapRef.current.panTo([lon, lat]);
        if (markerRef.current) markerRef.current.setLngLat([lon, lat]);
      }
    }
  }

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [pos[1], pos[0]],
      zoom: 11,
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const marker = new maplibregl.Marker({ color: "#1C1C1A", draggable: true })
      .setLngLat([pos[1], pos[0]])
      .addTo(map);

    markerRef.current = marker;

    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      setPos([lngLat.lat, lngLat.lng]);
      map.panTo([lngLat.lng, lngLat.lat]);
    });

    map.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      marker.setLngLat([lng, lat]);
      setPos([lat, lng]);
      map.panTo([lng, lat]);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []); // init once only

  // Redraw radius circle when pos or meters changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // map is passed as parameter to avoid TypeScript closure narrowing issues
    function drawCircle(m: maplibregl.Map) {
      if (m.getLayer("radius-fill")) m.removeLayer("radius-fill");
      if (m.getLayer("radius-border")) m.removeLayer("radius-border");
      if (m.getSource("radius")) m.removeSource("radius");

      if (meters > 0) {
        const [lat, lng] = pos;
        const numPoints = 64;
        const coords: [number, number][] = [];
        for (let i = 0; i < numPoints; i++) {
          const angle = (i / numPoints) * 2 * Math.PI;
          const dx = (meters / 111320) * Math.cos(angle);
          const dy = (meters / (111320 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle);
          coords.push([lng + dy, lat + dx]);
        }
        coords.push(coords[0]);

        m.addSource("radius", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "Polygon", coordinates: [coords] },
            properties: {},
          },
        });
        m.addLayer({
          id: "radius-fill",
          type: "fill",
          source: "radius",
          paint: { "fill-color": "#1C1C1A", "fill-opacity": 0.1 },
        });
        m.addLayer({
          id: "radius-border",
          type: "line",
          source: "radius",
          paint: { "line-color": "#1C1C1A", "line-width": 2, "line-opacity": 0.5 },
        });
      }
    }

    if (map.isStyleLoaded()) {
      drawCircle(map);
    } else {
      map.once("idle", () => drawCircle(map));
    }

    // Hide marker when radius is set — circle replaces pin for privacy
    if (markerRef.current) {
      markerRef.current.getElement().style.display = meters > 0 ? "none" : "";
    }
  }, [meters, pos]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search address or place"
          className="flex-1 border rounded px-3 py-2"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              search((e.target as HTMLInputElement).value);
            }
          }}
        />
        <button
          type="button"
          className="border rounded px-3 py-2"
          onClick={() => {
            const el = document.activeElement as HTMLInputElement;
            search(el?.value ?? "");
          }}
        >
          Search
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border">
        <div ref={containerRef} style={{ height: 260, width: "100%" }} />
      </div>

      <div className="text-sm text-neutral-600">
        Drag the pin or click the map to set your pickup location.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs mb-1">Latitude</label>
          <input
            readOnly
            className="w-full border rounded px-3 py-2 bg-neutral-50"
            value={pos[0].toFixed(6)}
          />
        </div>
        <div>
          <label className="block text-xs mb-1">Longitude</label>
          <input
            readOnly
            className="w-full border rounded px-3 py-2 bg-neutral-50"
            value={pos[1].toFixed(6)}
          />
        </div>
        <div>
          <label className="block text-xs mb-1">Approximate radius (miles)</label>
          <input
            type="range"
            min={0}
            max={5}
            step={1}
            value={miles}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 0;
              setMiles(v);
              onMilesChange?.(v);
            }}
            className="w-full"
          />
          <div className="text-xs mt-1">
            {miles === 0 ? "Exact pin" : `${miles} mi area`}
          </div>
        </div>
      </div>

      {/* Hidden fields that submit with the form */}
      <input type="hidden" name="lat" value={pos[0]} />
      <input type="hidden" name="lng" value={pos[1]} />
      <input type="hidden" name="radiusMeters" value={meters} />
    </div>
  );
}
