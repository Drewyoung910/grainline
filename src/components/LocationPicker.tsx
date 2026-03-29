"use client";

import { MapContainer, TileLayer, Marker, useMapEvents, Circle } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import { useEffect, useMemo, useState } from "react";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

function DraggableMarker({
  value,
  onChange,
}: {
  value: [number, number];
  onChange: (v: [number, number]) => void;
}) {
  const [pos, setPos] = useState<[number, number]>(value);
  useEffect(() => setPos(value), [value]);

  const markerRef = (ref: L.Marker | null) => {
    if (ref) {
      ref.on("dragend", () => {
        const p = ref.getLatLng();
        onChange([p.lat, p.lng]);
      });
    }
  };

  useMapEvents({
    click(e) {
      onChange([e.latlng.lat, e.latlng.lng]);
    },
  });

  return <Marker draggable position={pos} ref={markerRef as React.Ref<L.Marker>} />;
}

export default function LocationPicker({
  defaultLat,
  defaultLng,
  defaultRadiusMeters,
}: {
  defaultLat?: number | null;
  defaultLng?: number | null;
  defaultRadiusMeters?: number | null;
}) {
  const start: [number, number] = useMemo(
    () => [defaultLat ?? 30.2672, defaultLng ?? -97.7431], // Austin as a friendly default
    [defaultLat, defaultLng]
  );

  const [pos, setPos] = useState<[number, number]>(start);
  const [miles, setMiles] = useState<number>(
    defaultRadiusMeters ? Math.round(defaultRadiusMeters / 1609.34) : 0
  );
  const meters = miles > 0 ? Math.round(miles * 1609.34) : 0;

  async function search(q: string) {
    if (!q) return;
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
      q
    )}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await res.json();
    if (Array.isArray(data) && data[0]) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) setPos([lat, lon]);
    }
  }

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
            const el = (document.activeElement as HTMLInputElement);
            const val = el?.value ?? "";
            search(val);
          }}
        >
          Search
        </button>
      </div>

      <div className="rounded-xl overflow-hidden border">
        <MapContainer center={pos} zoom={12} style={{ height: 260, width: "100%" }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap"
          />
          <DraggableMarker value={pos} onChange={setPos} />
          {meters > 0 && (
            <Circle
              center={pos}
              radius={meters}
              pathOptions={{ color: "#2563eb", fillOpacity: 0.15 }}
            />
          )}
        </MapContainer>
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
            onChange={(e) => setMiles(parseInt(e.target.value) || 0)}
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
