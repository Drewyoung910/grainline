"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState, useMemo } from "react";
import * as maplibregl from "@/lib/maplibreClient";
import SellerLocationSearch from "@/components/SellerLocationSearch";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";
import { sellerLocationPoint } from "@/lib/sellerShopSettingsInput";

const DEFAULT_MAP_CENTER: [number, number] = [30.2672, -97.7431];

export default function LocationPicker({
  defaultLat,
  defaultLng,
  defaultRadiusMeters,
  onMilesChange,
  onLocationChange,
}: {
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadiusMeters?: number | null;
  onMilesChange?: (miles: number) => void;
  onLocationChange?: (lat: number, lng: number) => void;
}) {
  const savedPoint = useMemo(
    () => sellerLocationPoint(defaultLat, defaultLng),
    [defaultLat, defaultLng]
  );
  const start: [number, number] = useMemo(
    () => savedPoint
      ? [savedPoint.lat, savedPoint.lng]
      : DEFAULT_MAP_CENTER,
    [savedPoint],
  );

  const [pos, setPos] = useState<[number, number] | null>(
    savedPoint ? [savedPoint.lat, savedPoint.lng] : null,
  );
  const [miles, setMiles] = useState<number>(
    savedPoint && defaultRadiusMeters
      ? Math.round(defaultRadiusMeters / 1609.34)
      : 0
  );
  const [mapUnavailable, setMapUnavailable] = useState(false);
  const meters = miles > 0 ? Math.round(miles * 1609.34) : 0;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const onLocationChangeRef = useRef(onLocationChange);

  useEffect(() => {
    onLocationChangeRef.current = onLocationChange;
  }, [onLocationChange]);

  useEffect(() => {
    if (!containerRef.current) return;
    setMapUnavailable(false);
    if (!maplibreSupported(maplibregl)) {
      setMapUnavailable(true);
      return;
    }
    const [startLat, startLng] = start;
    // On touch screens a one-finger swipe should scroll the settings page,
    // not pan the map; cooperative gestures require two fingers to move it.
    // Same query MapLibre uses to pick its mobile gesture message.
    const touchPrimary = window.matchMedia("(hover: none), (pointer: coarse)").matches;

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: [startLng, startLat],
        zoom: 11,
        cooperativeGestures: touchPrimary,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const marker = new maplibregl.Marker({ color: "#1C1C1A", draggable: true })
      .setLngLat([startLng, startLat])
      .addTo(map);
    marker.getElement().style.display = savedPoint ? "" : "none";
    // Cooperative gestures let the page scroll from the map canvas
    // (touch-action: pan-x pan-y); keep a one-finger drag on the pin itself.
    marker.getElement().style.touchAction = "none";

    markerRef.current = marker;

    marker.on("dragend", () => {
      const lngLat = marker.getLngLat();
      setPos([lngLat.lat, lngLat.lng]);
      onLocationChangeRef.current?.(lngLat.lat, lngLat.lng);
      map.panTo([lngLat.lng, lngLat.lat]);
    });

    map.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      marker.setLngLat([lng, lat]);
      setPos([lat, lng]);
      onLocationChangeRef.current?.(lat, lng);
      map.panTo([lng, lat]);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [savedPoint, start]);

  // Redraw radius circle when pos or meters changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // map is passed as parameter to avoid TypeScript closure narrowing issues
    function drawCircle(m: maplibregl.Map) {
      if (m.getLayer("radius-fill")) m.removeLayer("radius-fill");
      if (m.getLayer("radius-border")) m.removeLayer("radius-border");
      if (m.getSource("radius")) m.removeSource("radius");

      if (meters > 0 && pos) {
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
      markerRef.current.getElement().style.display = pos === null || meters > 0
        ? "none"
        : "";
    }
  }, [meters, pos]);

  return (
    <div className="space-y-2">
      <SellerLocationSearch
        onSelect={(location) => {
          setPos([location.lat, location.lng]);
          onLocationChange?.(location.lat, location.lng);
          if (mapRef.current) mapRef.current.panTo([location.lng, location.lat]);
          if (markerRef.current) markerRef.current.setLngLat([location.lng, location.lat]);
        }}
      />

      {mapUnavailable ? (
        <MapFallback
          className="min-h-[260px] w-full rounded-xl border border-neutral-200"
          message="Map picker is unavailable because WebGL is disabled or unsupported. Search a city or ZIP to set the general area."
          lat={pos?.[0] ?? null}
          lng={pos?.[1] ?? null}
        />
      ) : (
        <div className="rounded-xl overflow-hidden border border-neutral-200">
          <div
            ref={containerRef}
            role="application"
            aria-label="Map picker for pickup location"
            aria-describedby="pickup-location-map-help"
            style={{ height: 260, width: "100%" }}
          />
        </div>
      )}

      <div id="pickup-location-map-help" className="text-sm text-neutral-600">
        {mapUnavailable ? "Search a city or ZIP to set the general area." : "Search a city or ZIP, then drag the pin or click the map to choose the saved location."}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-xs mb-1">Latitude</label>
          <input
            readOnly
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            value={pos?.[0].toFixed(6) ?? ""}
            placeholder="Not set"
          />
        </div>
        <div>
          <label className="block text-xs mb-1">Longitude</label>
          <input
            readOnly
            className="w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm"
            value={pos?.[1].toFixed(6) ?? ""}
            placeholder="Not set"
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
            disabled={pos === null}
            onChange={(e) => {
              const v = parseInt(e.target.value) || 0;
              setMiles(v);
              onMilesChange?.(v);
            }}
            className="w-full disabled:cursor-not-allowed disabled:opacity-40"
          />
          <div className="text-xs mt-1">
            {pos === null
              ? "Set a location before choosing a privacy radius"
              : miles === 0
              ? "Saved point (public display stays approximate unless you separately opt in below)"
              : `${miles} mi private area`}
          </div>
        </div>
      </div>

      {/* Hidden fields that submit with the form */}
      <input type="hidden" name="lat" value={pos?.[0] ?? ""} />
      <input type="hidden" name="lng" value={pos?.[1] ?? ""} />
      <input type="hidden" name="radiusMeters" value={pos ? meters : ""} />
    </div>
  );
}
