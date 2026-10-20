import { auth } from "@clerk/nextjs/server";
import * as Sentry from "@sentry/nextjs";
import { NextRequest } from "next/server";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { prisma } from "@/lib/db";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { getIP, rateLimitResponse, safeRateLimit, searchRatelimit, redis } from "@/lib/ratelimit";
import { sellerOwnerCore } from "@/lib/sellerProfileOwnerAccess";
import {
  normalizeSellerLocationSearchQuery,
  sellerLocationPlaceToResult,
} from "@/lib/sellerLocationSearchState";
import type { NominatimPlace } from "@/lib/addressAutocompleteState";
import { userClerkGate } from "@/lib/userIdentityAccess";
import { waitForNominatimSharedThrottle } from "@/lib/nominatimThrottleState";

const NOMINATIM_USER_AGENT = "Grainline/1.0 (https://thegrainline.com; support@thegrainline.com)";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: 401 });

  const me = await userClerkGate(prisma, userId);
  if (!me) return privateJson({ error: "Unauthorized" }, { status: 401 });
  if (me.banned || me.deletedAt) {
    return privateJson({ error: "Account is suspended" }, { status: 403 });
  }
  if (!(await sellerOwnerCore(me.id))) {
    return privateJson({ error: "No seller profile" }, { status: 403 });
  }

  const { success, reset } = await safeRateLimit(
    searchRatelimit,
    `seller-location:${me.id}:${getIP(req)}`,
  );
  if (!success) {
    return privateResponse(rateLimitResponse(reset, "Too many location searches."));
  }

  const query = normalizeSellerLocationSearchQuery(req.nextUrl.searchParams.get("q"));
  if (!query) {
    return privateJson(
      { error: "Enter a US city and state, such as Austin, TX, or a ZIP code." },
      { status: 400 },
    );
  }

  const throttleReady = await waitForNominatimSharedThrottle({
    setLock: (key, value, options) => redis.set(key, value, options),
    sleep,
    onError: (error) => Sentry.captureException(error, {
      tags: { source: "seller_location_search_throttle" },
    }),
    onContentionExceeded: () => Sentry.captureMessage(
      "Seller location search throttle contention exceeded",
      { level: "warning", tags: { source: "seller_location_search_throttle" } },
    ),
  });
  if (!throttleReady) return privateJson({ results: [] }, { status: 503 });

  const params = new URLSearchParams({
    q: `${query}, United States`,
    format: "jsonv2",
    addressdetails: "1",
    dedupe: "1",
    "accept-language": "en-US",
    countrycodes: "us",
    limit: "5",
  });

  try {
    const response = await fetchWithTimeout(
      `https://nominatim.openstreetmap.org/search?${params.toString()}`,
      {
        headers: {
          Accept: "application/json",
          "Accept-Language": "en-US",
          "User-Agent": NOMINATIM_USER_AGENT,
        },
      },
      8_000,
    );
    if (!response.ok) return privateJson({ results: [] }, { status: 502 });
    const places = (await response.json()) as NominatimPlace[];
    const results = Array.isArray(places)
      ? places.map(sellerLocationPlaceToResult).filter((item) => item !== null).slice(0, 5)
      : [];
    return privateJson({ results });
  } catch (error) {
    Sentry.captureException(error, { tags: { source: "seller_location_search" } });
    return privateJson({ results: [] }, { status: 502 });
  }
}
