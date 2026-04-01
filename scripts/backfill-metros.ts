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

// State name → two-letter code map (inline to avoid src/ import issues)
const STATE_CODES: Record<string, string> = {
  Alabama: "al", Alaska: "ak", Arizona: "az", Arkansas: "ar", California: "ca",
  Colorado: "co", Connecticut: "ct", Delaware: "de", Florida: "fl", Georgia: "ga",
  Hawaii: "hi", Idaho: "id", Illinois: "il", Indiana: "in", Iowa: "ia",
  Kansas: "ks", Kentucky: "ky", Louisiana: "la", Maine: "me", Maryland: "md",
  Massachusetts: "ma", Michigan: "mi", Minnesota: "mn", Mississippi: "ms",
  Missouri: "mo", Montana: "mt", Nebraska: "ne", Nevada: "nv",
  "New Hampshire": "nh", "New Jersey": "nj", "New Mexico": "nm", "New York": "ny",
  "North Carolina": "nc", "North Dakota": "nd", Ohio: "oh", Oklahoma: "ok",
  Oregon: "or", Pennsylvania: "pa", "Rhode Island": "ri", "South Carolina": "sc",
  "South Dakota": "sd", Tennessee: "tn", Texas: "tx", Utah: "ut",
  Vermont: "vt", Virginia: "va", Washington: "wa", "West Virginia": "wv",
  Wisconsin: "wi", Wyoming: "wy",
};

let lastNominatimRequest = 0;
async function nominatimReverse(lat: number, lng: number): Promise<{ city: string; state: string; stateCode: string } | null> {
  try {
    const elapsed = Date.now() - lastNominatimRequest;
    if (elapsed < 1100) await new Promise((r) => setTimeout(r, 1100 - elapsed));
    lastNominatimRequest = Date.now();
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
      { headers: { "User-Agent": "Grainline/1.0 (thegrainline.com)" } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data?.address;
    if (!addr || addr.country_code !== "us") return null;
    const city: string = addr.city || addr.town || addr.village || addr.hamlet || addr.county || "";
    const stateName: string = addr.state || "";
    const stateCode = STATE_CODES[stateName];
    if (!city || !stateCode) return null;
    return { city, state: stateName, stateCode };
  } catch { return null; }
}

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

  // Helper: resolve or auto-create a metro for the given coordinates
  async function resolveOrCreate(lat: number, lng: number): Promise<{ metroId: string | null; cityMetroId: string | null }> {
    const result = resolveMetros(lat, lng, metros);
    if (result.metroId || result.cityMetroId) return result;
    // Auto-create via reverse geocoding
    const geo = await nominatimReverse(lat, lng);
    if (!geo) return { metroId: null, cityMetroId: null };
    const citySlug = geo.city.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const slug = `${citySlug}-${geo.stateCode}`;
    const metro = await prisma.metro.upsert({
      where: { slug },
      update: {},
      create: { slug, name: geo.city, state: geo.state, latitude: lat, longitude: lng, radiusMiles: 45, isActive: true },
    });
    console.log(`  [auto-created metro] ${slug} (${geo.city}, ${geo.state})`);
    // Refresh the in-memory list so subsequent points in the same metro are found
    metros.push({ id: metro.id, slug: metro.slug, latitude: metro.latitude, longitude: metro.longitude, radiusMiles: metro.radiusMiles, parentMetroId: null });
    return { metroId: metro.id, cityMetroId: null };
  }

  // --- Seller profiles ---
  const sellers = await prisma.sellerProfile.findMany({
    where: { metroId: null, lat: { not: null }, lng: { not: null } },
    select: { id: true, lat: true, lng: true },
  });
  console.log(`Backfilling ${sellers.length} seller profiles...`);
  let sellerUpdated = 0;
  for (const s of sellers) {
    if (s.lat == null || s.lng == null) continue;
    const { metroId, cityMetroId } = await resolveOrCreate(s.lat, s.lng);
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
    const { metroId, cityMetroId } = await resolveOrCreate(lat, lng);
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
    const { metroId, cityMetroId } = await resolveOrCreate(c.lat, c.lng);
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
