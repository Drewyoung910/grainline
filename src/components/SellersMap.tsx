"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { publicSellerPath } from "@/lib/publicPaths";
import MapFallback from "@/components/MapFallback";
import { maplibreSupported } from "@/lib/mapSupport";
import { buildMakerCardSkeleton, upgradeMakerPopup, type MakerCardData } from "@/lib/mapMakerCard";

type SellerPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city?: string | null;
  state?: string | null;
};

export default function SellersMap({ sellers }: { sellers: SellerPin[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapUnavailable, setMapUnavailable] = useState(false);

  const center: [number, number] = useMemo(
    () => (sellers.length ? [sellers[0].lng, sellers[0].lat] : [-98.35, 39.5]),
    [sellers],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    setMapUnavailable(false);
    if (!maplibreSupported(maplibregl)) {
      setMapUnavailable(true);
      return;
    }

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center,
        zoom: sellers.length ? 8 : 4,
      });
    } catch {
      setMapUnavailable(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // Maker card data cache — one fetch per seller per map mount.
    const cardCache = new Map<string, MakerCardData | null>();
    const markers: maplibregl.Marker[] = [];

    map.on("load", () => {
      for (const seller of sellers) {
        const popup = new maplibregl.Popup({
          offset: 25,
          maxWidth: "280px",
          className: "maker-card-popup",
        }).setDOMContent(
          buildMakerCardSkeleton(
            seller.name,
            seller.city ?? null,
            seller.state ?? null,
            publicSellerPath(seller.id, seller.name)
          )
        );
        popup.on("open", () => {
          void upgradeMakerPopup(popup, seller.id, cardCache);
        });

        const marker = new maplibregl.Marker({ color: "#1C1C1A" })
          .setLngLat([seller.lng, seller.lat])
          .setPopup(popup)
          .addTo(map);
        markers.push(marker);
      }
    });

    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [sellers, center]);

  if (mapUnavailable) {
    return (
      <MapFallback
        className="min-h-[320px] w-full rounded-xl border border-neutral-200"
        message="Map is unavailable because WebGL is disabled or unsupported."
        lat={sellers[0]?.lat}
        lng={sellers[0]?.lng}
        links={sellers.slice(0, 6).map((seller) => ({
          href: publicSellerPath(seller.id, seller.name),
          label: seller.name,
        }))}
      />
    );
  }

  return (
    <div className="rounded-xl overflow-hidden border">
      <div
        ref={containerRef}
        role="application"
        aria-label="Map of Grainline sellers"
        style={{ height: 520, width: "100%" }}
      />
    </div>
  );
}
