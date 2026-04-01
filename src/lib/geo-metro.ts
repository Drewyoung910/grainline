// src/lib/geo-metro.ts
// Geo-mapping utility for assigning metro areas to listings, commissions, and seller profiles.

import { prisma } from "@/lib/db";
import { reverseGeocode } from "@/lib/reverse-geocode";

// ---------------------------------------------------------------------------
// Haversine distance in miles between two lat/lng points
// ---------------------------------------------------------------------------
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
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

type MetroResult = {
  id: string;
  slug: string;
  name: string;
  state: string;
  parentMetroId: string | null;
};

// ---------------------------------------------------------------------------
// findNearestMetro
// Returns the closest active metro to the given coordinates.
// Checks child metros first (more specific), then falls back to major metros.
// Returns both the specific city metro and the parent major metro if applicable.
// ---------------------------------------------------------------------------
export async function findNearestMetro(
  lat: number,
  lng: number
): Promise<{ cityMetro: MetroResult | null; majorMetro: MetroResult | null }> {
  const metros = await prisma.metro.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, name: true, state: true, latitude: true, longitude: true, radiusMiles: true, parentMetroId: true },
  });

  const children = metros.filter((m) => m.parentMetroId !== null);
  const majors = metros.filter((m) => m.parentMetroId === null);

  // Find closest child metro within its radius
  let closestChild: MetroResult | null = null;
  let closestChildDist = Infinity;
  for (const m of children) {
    const dist = haversineMiles(lat, lng, m.latitude, m.longitude);
    if (dist <= m.radiusMiles && dist < closestChildDist) {
      closestChildDist = dist;
      closestChild = { id: m.id, slug: m.slug, name: m.name, state: m.state, parentMetroId: m.parentMetroId };
    }
  }

  // Find closest major metro within its radius
  let closestMajor: MetroResult | null = null;
  let closestMajorDist = Infinity;
  for (const m of majors) {
    const dist = haversineMiles(lat, lng, m.latitude, m.longitude);
    if (dist <= m.radiusMiles && dist < closestMajorDist) {
      closestMajorDist = dist;
      closestMajor = { id: m.id, slug: m.slug, name: m.name, state: m.state, parentMetroId: null };
    }
  }

  // If child found, confirm its parent matches the nearest major (or use whatever parent it has)
  if (closestChild && closestChild.parentMetroId) {
    const parent = metros.find((m) => m.id === closestChild!.parentMetroId);
    if (parent) {
      closestMajor = { id: parent.id, slug: parent.slug, name: parent.name, state: parent.state, parentMetroId: null };
    }
  }

  return { cityMetro: closestChild, majorMetro: closestMajor };
}

// ---------------------------------------------------------------------------
// mapToMetros
// Returns { metroId, cityMetroId } for storing on a listing/commission/profile.
// metroId = major metro, cityMetroId = specific child metro (or null).
// ---------------------------------------------------------------------------
export async function mapToMetros(
  lat: number,
  lng: number
): Promise<{ metroId: string | null; cityMetroId: string | null }> {
  const { cityMetro, majorMetro } = await findNearestMetro(lat, lng);
  return {
    metroId: majorMetro?.id ?? null,
    cityMetroId: cityMetro?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// findOrCreateMetro
// Like mapToMetros but auto-creates a metro via reverse geocoding when no
// existing metro is found nearby.
// ---------------------------------------------------------------------------
export async function findOrCreateMetro(
  lat: number,
  lng: number
): Promise<{ metroId: string | null; cityMetroId: string | null }> {
  const { cityMetro, majorMetro } = await findNearestMetro(lat, lng);

  if (majorMetro) {
    return {
      metroId: majorMetro.id,
      cityMetroId: cityMetro?.id ?? null,
    };
  }

  // No nearby metro — attempt to create one via reverse geocoding
  try {
    const geo = await reverseGeocode(lat, lng);
    if (!geo) return { metroId: null, cityMetroId: null };

    // Build slug: "city-name-st" (lowercase, spaces→hyphens)
    const citySlug = geo.city
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    const slug = `${citySlug}-${geo.stateCode}`;

    const metro = await prisma.metro.upsert({
      where: { slug },
      update: {},
      create: {
        slug,
        name: geo.city,
        state: geo.state,
        latitude: lat,
        longitude: lng,
        radiusMiles: 45,
        isActive: true,
      },
    });

    console.log(`[geo-metro] Auto-created metro: ${slug} (${geo.city}, ${geo.state})`);

    return { metroId: metro.id, cityMetroId: null };
  } catch {
    return { metroId: null, cityMetroId: null };
  }
}

// ---------------------------------------------------------------------------
// isMetroSlug
// Returns true if the string matches the metro slug format:
// lowercase letters and hyphens, ending with a two-letter state code like -tx.
// Used to distinguish metro slugs from CUIDs and other route params.
// ---------------------------------------------------------------------------
export function isMetroSlug(slug: string): boolean {
  return /^[a-z][a-z0-9-]+-[a-z]{2}$/.test(slug);
}
