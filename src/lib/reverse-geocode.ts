// src/lib/reverse-geocode.ts
// Reverse geocoding via Nominatim (OpenStreetMap).
// Nominatim policy: max 1 request per second.
// Never crashes — all errors return null.
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { redis } from "@/lib/ratelimit";

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

let lastRequestTime = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForLocalThrottle() {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1100) {
    await sleep(1100 - elapsed);
  }
  lastRequestTime = Date.now();
}

async function waitForSharedThrottle() {
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const locked = await redis.set("reverse-geocode:nominatim:lock", "1", { nx: true, px: 1100 });
      if (locked) return;
      await sleep(200);
    }
  } catch {
    await waitForLocalThrottle();
  }
}

async function throttledFetch(url: string): Promise<Response> {
  await waitForSharedThrottle();
  return fetchWithTimeout(url, {
    headers: { "User-Agent": "Grainline/1.0 (thegrainline.com)" },
  }, 8_000);
}

export type GeoResult = { city: string; state: string; stateCode: string };

export async function reverseGeocode(lat: number, lng: number): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`;
    const res = await throttledFetch(url);
    if (!res.ok) return null;

    const data = await res.json();
    const addr = data?.address;
    if (!addr) return null;

    // Nominatim returns country_code as lowercase ISO two-letter
    if (addr.country_code !== "us") return null;

    const city: string =
      addr.city || addr.town || addr.village || addr.hamlet || addr.county || "";
    const stateName: string = addr.state || "";

    if (!city || !stateName) return null;

    const stateCode = STATE_CODES[stateName];
    if (!stateCode) return null;

    return { city, state: stateName, stateCode };
  } catch {
    return null;
  }
}
