// src/app/sellers/map/page.tsx
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import SellersMap from "@/components/SellersMap";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { sellerPublicMapPoints } from "@/lib/sellerProfilePublicAccess";

export const dynamic = "force-dynamic";

export default async function SellersMapPage() {
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const meRow = await userIdByClerkId(prisma, userId);
    meDbId = meRow?.id ?? null;
  }
  const pins = (await sellerPublicMapPoints(meDbId, 500)).map((seller) => ({
    id: seller.id,
    name: seller.displayName || "Maker",
    lat: seller.publicLat,
    lng: seller.publicLng,
    city: seller.city,
    state: seller.state,
  }));

  return (
    <main className="max-w-7xl mx-auto p-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Find makers near you</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Makers choose an approximate pin or explicitly publish an exact one. Click a pin to preview a profile.
          </p>
        </div>
      </header>

      <SellersMap sellers={pins} />
    </main>
  );
}
