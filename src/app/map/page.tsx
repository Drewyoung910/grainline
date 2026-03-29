// src/app/map/page.tsx
import { prisma } from "@/lib/db";
import AllSellersMap from "@/components/AllSellersMap";

type Point = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
};

export default async function AllSellersMapPage({
  searchParams,
}: {
  searchParams: Promise<{ near?: string; zoom?: string }>;
}) {
  const { near, zoom } = await searchParams;

  let initialCenter: { lat: number; lng: number } | null = null;
  let initialZoom = 10;

  if (near) {
    const [latStr, lngStr] = near.split(",");
    const lat = Number(latStr);
    const lng = Number(lngStr);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      initialCenter = { lat, lng };
    }
  }
  if (zoom) {
    const z = parseInt(zoom, 10);
    if (Number.isFinite(z)) initialZoom = z;
  }

  // Only sellers with a precise pin (lat & lng present). Exclude radius-only rows.
  const sellers = await prisma.sellerProfile.findMany({
    where: {
      publicMapOptIn: true,
      lat: { not: null },
      lng: { not: null },
      OR: [{ radiusMeters: null }, { radiusMeters: 0 }],
    },
    select: {
      id: true,
      displayName: true,
      city: true,
      state: true,
      lat: true,
      lng: true,
    },
  });

  const points: Point[] = sellers
    .map((s) => ({
      id: s.id,
      name: s.displayName ?? "Seller",
      lat: Number(s.lat),
      lng: Number(s.lng),
      city: s.city,
      state: s.state,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Makers near you</h1>
          <p className="text-sm text-neutral-500 mt-1">
            Showing {points.length} maker{points.length === 1 ? "" : "s"} with exact pickup locations.
          </p>
        </div>
      </header>

      <section className="rounded-xl border overflow-hidden">
        {/* Client map; no SSR */}
        <AllSellersMap
          points={points}
          initialCenter={initialCenter}
          initialZoom={initialZoom}
        />
      </section>
    </main>
  );
}

