// src/app/sellers/map/page.tsx
import { prisma } from "@/lib/db";
import { userIdByClerkId } from "@/lib/userIdentityAccess";
import SellersMap from "@/components/SellersMap";
import { activeSellerProfileWhere } from "@/lib/sellerVisibility";
import { auth } from "@clerk/nextjs/server";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { isSupportedLocationPoint, publicSellerLocationPoint } from "@/lib/locationPrivacy";

export const dynamic = "force-dynamic";

export default async function SellersMapPage() {
  const { userId } = await auth();
  let meDbId: string | null = null;
  if (userId) {
    const meRow = await userIdByClerkId(prisma, userId);
    meDbId = meRow?.id ?? null;
  }
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(meDbId);

  const sellers = await prisma.sellerProfile.findMany({
    where: {
      lat: { not: null },
      lng: { not: null },
      publicMapOptIn: true,
      ...activeSellerProfileWhere(),
      ...(blockedSellerIds.length > 0 ? { id: { notIn: blockedSellerIds } } : {}),
      OR: [{ radiusMeters: null }, { radiusMeters: 0 }],
    },
    select: { id: true, displayName: true, city: true, state: true, lat: true, lng: true },
    orderBy: { id: "asc" },
    take: 500,
  });

  const pins = sellers.flatMap((seller) => {
    const lat = Number(seller.lat);
    const lng = Number(seller.lng);
    if (!isSupportedLocationPoint(lat, lng)) return [];
    const publicPoint = publicSellerLocationPoint({ lat, lng, radiusMeters: 0 });
    return [{
      id: seller.id,
      name: seller.displayName ?? "Maker",
      lat: publicPoint.lat,
      lng: publicPoint.lng,
      city: seller.city,
      state: seller.state,
    }];
  });

  return (
    <main className="max-w-7xl mx-auto p-8 space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold">Find makers near you</h1>
          <p className="text-sm text-neutral-600 mt-1">
            Makers who opted into the public map appear as approximate pins. Click a pin to preview a profile.
          </p>
        </div>
      </header>

      <SellersMap sellers={pins} />
    </main>
  );
}
