// src/lib/reverse-geocode.ts
// Broad locality geocoding via Nominatim (OpenStreetMap).
// Nominatim policy: max 1 request per second.
// Exact caller coordinates and street addresses are outside this contract.
// Never crashes — all errors return null.
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { redis } from "@/lib/ratelimit";
import * as Sentry from "@sentry/nextjs";
import { waitForNominatimSharedThrottle } from "./nominatimThrottleState.ts";
import { normalizeUsState, US_STATES } from "./usStates.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSharedThrottle() {
  return waitForNominatimSharedThrottle({
    setLock: (key, value, options) => redis.set(key, value, options),
    sleep,
    onError: (error) =>
      Sentry.captureException(error, { tags: { source: "reverse_geocode_throttle" } }),
    onContentionExceeded: () =>
      Sentry.captureMessage("Reverse geocode shared throttle contention exceeded", {
        level: "warning",
        tags: { source: "reverse_geocode_throttle" },
      }),
  });
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

async function lookupLocalityCentroid(city: string, stateCode: string) {
  const params = new URLSearchParams({
    q: `${city}, ${stateCode}, United States`,
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

export async function geocodePublicLocality(
  cityInput: string,
  stateInput: string,
): Promise<GeoResult | null> {
  const city = cityInput.replace(/\s+/g, " ").trim();
  const stateCode = normalizeUsState(stateInput);
  const state = US_STATES.find((candidate) => candidate.code === stateCode)?.name ?? "";
  if (
    !city
    || city.length > 80
    || /\d/u.test(city)
    || /\b(?:county|parish)\b/iu.test(city)
    || !stateCode
    || !state
  ) return null;
  try {
    const centroid = await lookupLocalityCentroid(city, stateCode);
    if (!centroid) return null;

    return {
      city,
      state,
      stateCode: stateCode.toLowerCase(),
      latitude: centroid.latitude,
      longitude: centroid.longitude,
    };
  } catch {
    return null;
  }
}
