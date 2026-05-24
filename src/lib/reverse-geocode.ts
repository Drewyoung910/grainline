// src/lib/reverse-geocode.ts
// Reverse geocoding via Nominatim (OpenStreetMap).
// Nominatim policy: max 1 request per second.
// Never crashes — all errors return null.
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { redis } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSharedThrottle() {
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const locked = await redis.set("reverse-geocode:nominatim:lock", "1", { nx: true, px: 1100 });
      if (locked) return true;
      await sleep(200);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "reverse_geocode_throttle" } });
    return false;
  }
  Sentry.captureMessage("Reverse geocode shared throttle contention exceeded", {
    level: "warning",
    tags: { source: "reverse_geocode_throttle" },
  });
  return false;
}

async function throttledFetch(url: string): Promise<Response | null> {
  if (!(await waitForSharedThrottle())) return null;
  return fetchWithTimeout(url, {
    headers: { "User-Agent": "Grainline/1.0 (thegrainline.com)" },
  }, 8_000);
}

function roundedPublicMetroCoordinate(value: number) {
  return Number(value.toFixed(2));
}

export type GeoResult = {
  city: string;
  state: string;
  stateCode: string;
  latitude: number;
  longitude: number;
};

async function lookupLocalityCentroid(city: string, state: string) {
  const params = new URLSearchParams({
    q: `${city}, ${state}, United States`,
    format: "json",
    limit: "1",
    countrycodes: "us",
  });
  const res = await throttledFetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`);
  if (!res?.ok) return null;

  const data = await res.json();
  const first = Array.isArray(data) ? data[0] : null;
  const latitude = Number(first?.lat);
  const longitude = Number(first?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return null;
  }

  return {
    latitude: roundedPublicMetroCoordinate(latitude),
    longitude: roundedPublicMetroCoordinate(longitude),
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      lat: String(lat),
      lon: String(lng),
      format: "json",
      addressdetails: "1",
    });
    const url = `https://nominatim.openstreetmap.org/reverse?${params.toString()}`;
    const res = await throttledFetch(url);
    if (!res) return null;
    if (!res.ok) return null;

    const data = await res.json();
    const addr = data?.address;
    if (!addr) return null;

    // Nominatim returns country_code as lowercase ISO two-letter
    if (addr.country_code !== "us") return null;

    // Real localities only. Do not fall back to county or other sublocality
    // names like suburb/neighbourhood/city_district — those produce labels
    // like "DeWitt County, Texas" which are confusing for buyers and SEO.
    const cityRaw: string =
      addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || "";
    const stateName: string = addr.state || "";

    if (!cityRaw || !stateName) return null;
    // Defensive: reject anything that's clearly a county or admin-only label.
    const looksLikeCounty = /\bcounty\b/i.test(cityRaw) || /\bparish\b/i.test(cityRaw);
    if (looksLikeCounty) return null;
    const city = cityRaw;

    const stateCode = STATE_CODES[stateName];
    if (!stateCode) return null;
    const centroid = await lookupLocalityCentroid(city, stateName);
    if (!centroid) return null;

    return {
      city,
      state: stateName,
      stateCode,
      latitude: centroid.latitude,
      longitude: centroid.longitude,
    };
  } catch {
    return null;
  }
}
