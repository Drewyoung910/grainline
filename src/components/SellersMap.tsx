"use client";

import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import Link from "next/link";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

type SellerPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string | null;
  state?: string | null;
};

export default function SellersMap({ sellers }: { sellers: SellerPin[] }) {
  const center = sellers.length
    ? ([sellers[0].lat, sellers[0].lng] as [number, number])
    : ([39.5, -98.35] as [number, number]); // US center

  return (
    <div className="rounded-xl overflow-hidden border">
      <MapContainer center={center} zoom={sellers.length ? 8 : 4} maxZoom={18} minZoom={4} style={{ height: 520, width: "100%" }}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
        {sellers.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]}>
            <Popup>
              <div className="space-y-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-xs text-neutral-600">
                  {[s.city, s.state].filter(Boolean).join(", ")}
                </div>
                <Link href={`/seller/${s.id}`} className="text-sm underline">
                  View profile
                </Link>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
