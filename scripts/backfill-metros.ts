// scripts/backfill-metros.ts
// One-time script: assigns metroId/cityMetroId to all existing listings,
// commission requests, and seller profiles that have coordinates but no metroId.
//
// Run with:
//   npx dotenv-cli -e .env -- npx ts-node --transpile-only scripts/backfill-metros.ts

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const prisma = new PrismaClient({ adapter } as any);

// Inline Haversine (avoid importing from src/ which requires Next.js module resolution)
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type MetroRow = {
  id: string;
  slug: string;
  latitude: number;
  longitude: number;
  radiusMiles: number;
  parentMetroId: string | null;
};

function resolveMetros(
  lat: number,
  lng: number,
  metros: MetroRow[]
): { metroId: string | null; cityMetroId: string | null } {
  const children = metros.filter((m) => m.parentMetroId !== null);
  const majors = metros.filter((m) => m.parentMetroId === null);

  let closestChild: MetroRow | null = null;
  let closestChildDist = Infinity;
  for (const m of children) {
    const dist = haversineMiles(lat, lng, m.latitude, m.longitude);
    if (dist <= m.radiusMiles && dist < closestChildDist) {
      closestChildDist = dist;
      closestChild = m;
    }
  }

  let closestMajor: MetroRow | null = null;
  let closestMajorDist = Infinity;

  if (closestChild?.parentMetroId) {
    closestMajor = metros.find((m) => m.id === closestChild!.parentMetroId) ?? null;
  } else {
    for (const m of majors) {
      const dist = haversineMiles(lat, lng, m.latitude, m.longitude);
      if (dist <= m.radiusMiles && dist < closestMajorDist) {
        closestMajorDist = dist;
        closestMajor = m;
      }
    }
  }

  return {
    metroId: closestMajor?.id ?? null,
    cityMetroId: closestChild?.id ?? null,
  };
}

async function main() {
  console.log("Loading active metros...");
  const metros = await prisma.metro.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, latitude: true, longitude: true, radiusMiles: true, parentMetroId: true },
  });
  console.log(`  ${metros.length} metros loaded.\n`);

  // --- Seller profiles ---
  const sellers = await prisma.sellerProfile.findMany({
    where: { metroId: null, lat: { not: null }, lng: { not: null } },
    select: { id: true, lat: true, lng: true },
  });
  console.log(`Backfilling ${sellers.length} seller profiles...`);
  let sellerUpdated = 0;
  for (const s of sellers) {
    if (s.lat == null || s.lng == null) continue;
    const { metroId, cityMetroId } = resolveMetros(s.lat, s.lng, metros);
    if (metroId || cityMetroId) {
      await prisma.sellerProfile.update({ where: { id: s.id }, data: { metroId, cityMetroId } });
      sellerUpdated++;
    }
  }
  console.log(`  Updated ${sellerUpdated} seller profiles.\n`);

  // --- Listings (via seller's lat/lng) ---
  const listings = await prisma.listing.findMany({
    where: { metroId: null, seller: { lat: { not: null }, lng: { not: null } } },
    select: { id: true, seller: { select: { lat: true, lng: true } } },
  });
  console.log(`Backfilling ${listings.length} listings...`);
  let listingUpdated = 0;
  for (const l of listings) {
    const lat = l.seller?.lat;
    const lng = l.seller?.lng;
    if (lat == null || lng == null) continue;
    const { metroId, cityMetroId } = resolveMetros(lat, lng, metros);
    if (metroId || cityMetroId) {
      await prisma.listing.update({ where: { id: l.id }, data: { metroId, cityMetroId } });
      listingUpdated++;
    }
  }
  console.log(`  Updated ${listingUpdated} listings.\n`);

  // --- Commission requests ---
  const commissions = await prisma.commissionRequest.findMany({
    where: { metroId: null, lat: { not: null }, lng: { not: null } },
    select: { id: true, lat: true, lng: true },
  });
  console.log(`Backfilling ${commissions.length} commission requests...`);
  let commissionUpdated = 0;
  for (const c of commissions) {
    if (c.lat == null || c.lng == null) continue;
    const { metroId, cityMetroId } = resolveMetros(c.lat, c.lng, metros);
    if (metroId || cityMetroId) {
      await prisma.commissionRequest.update({ where: { id: c.id }, data: { metroId, cityMetroId } });
      commissionUpdated++;
    }
  }
  console.log(`  Updated ${commissionUpdated} commission requests.\n`);

  console.log("Backfill complete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
