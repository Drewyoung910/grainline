import { NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit, redis } from "@/lib/ratelimit";
import { normalizeAddressAutocompleteQuery, placeToAddress, type NominatimPlace } from "@/lib/addressAutocompleteState";
import { privateJson, privateResponse } from "@/lib/privateResponse";

const NOMINATIM_SHARED_THROTTLE_KEY = "reverse-geocode:nominatim:lock";
const NOMINATIM_USER_AGENT = "Grainline/1.0 (https://thegrainline.com; support@thegrainline.com)";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNominatimThrottle() {
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const locked = await redis.set(NOMINATIM_SHARED_THROTTLE_KEY, "1", { nx: true, px: 1100 });
      if (locked) return true;
      await sleep(200);
    }
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "address_autocomplete_throttle" } });
    return false;
  }

  Sentry.captureMessage("Address autocomplete shared Nominatim throttle contention exceeded", {
    level: "warning",
    tags: { source: "address_autocomplete_throttle" },
  });
  return false;
}

export async function GET(req: NextRequest) {
  const ip = getIP(req);
  const { success, reset } = await safeRateLimit(searchRatelimit, `address-autocomplete:${ip}`);
  if (!success) {
    return privateResponse(rateLimitResponse(reset, "Too many address searches."));
  }

  const q = normalizeAddressAutocompleteQuery(req.nextUrl.searchParams.get("q"));
  if (q.length < 2) return privateJson({ results: [] });

  if (!(await waitForNominatimThrottle())) {
    return privateJson({ results: [] }, { status: 503 });
  }

  const params = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    dedupe: "1",
    "accept-language": "en-US",
    countrycodes: "us",
    limit: "8",
    q,
  });

  try {
    const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    }, 8_000);

    if (!res.ok) {
      Sentry.captureMessage("Address autocomplete upstream request failed", {
        level: "warning",
        tags: { source: "address_autocomplete", status: String(res.status) },
      });
      return privateJson({ results: [] }, { status: 502 });
    }

    const data = (await res.json()) as NominatimPlace[];
    const results = Array.isArray(data) ? data.map(placeToAddress).filter((item) => item.label).slice(0, 8) : [];
    return privateJson({ results });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "address_autocomplete" } });
    return privateJson({ results: [] }, { status: 502 });
  }
}
