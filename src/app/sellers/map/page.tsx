// src/app/sellers/map/page.tsx
import { prisma } from "@/lib/db";
import SellersMap from "@/components/SellersMap";

export const dynamic = "force-dynamic";

export default async function SellersMapPage() {
  const sellers = await prisma.sellerProfile.findMany({
    where: {
      lat: { not: null },
      lng: { not: null },
      publicMapOptIn: true,
      OR: [{ radiusMeters: null }, { radiusMeters: 0 }], // exact pins only
    },
    select: { id: true, displayName: true, city: true, state: true, lat: true, lng: true },
    take: 500,
  });

  const pins = sellers.map((s) => ({
    id: s.id,
    name: s.displayName ?? "Seller",
    lat: Number(s.lat),
    lng: Number(s.lng),
    city: s.city,
    state: s.state,
  }));

  return (
    <main className="max-w-7xl mx-auto p-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Find makers near you</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Sellers who opted into the public map appear as exact pins. Click a pin to preview a profile.
          </p>
        </div>
      </header>

      <SellersMap sellers={pins} />
    </main>
  );
}
