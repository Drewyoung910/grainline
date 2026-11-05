import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

// Grainline's single shared Nominatim lock serves about one request per 1.1 s.
const SHARED_LOCK_REQUESTS_PER_MINUTE = 60 / 1.1;

function windowPerMinute(window) {
  const [count, span] = window;
  const [, amount, unit] = /^(\d+)\s*(s|m)$/.exec(span);
  return count * (60 / (Number(amount) * (unit === "m" ? 60 : 1)));
}

describe("address autocomplete fairness", () => {
  it("limits one visitor to a small share of the shared Nominatim lock", async () => {
    class Ratelimit {
      constructor(config) {
        this.window = config.limiter;
      }
      static slidingWindow(...window) {
        return window;
      }
    }
    const ratelimit = loadWithStubs("src/lib/ratelimit.ts", {
      "@upstash/ratelimit": { Ratelimit },
      "@upstash/redis": { Redis: class {} },
    });

    const used = [];
    let lockAttempts = 0;
    const route = loadWithStubs("src/app/api/address/autocomplete/route.ts", {
      "@/lib/ratelimit": {
        ...ratelimit,
        getIP: () => "203.0.113.7",
        safeRateLimit: async (limiter) => {
          used.push(limiter);
          return { success: false, reset: Date.now() + 1000 };
        },
        rateLimitResponse: () => new Response(null, { status: 429 }),
        redis: { set: async () => { lockAttempts += 1; return "OK"; } },
      },
      "@/lib/addressAutocompleteState": { normalizeAddressAutocompleteQuery: (q) => q ?? "" },
      "@/lib/privateResponse": { privateResponse: (response) => response },
    });

    const request = new Request("https://example.test/api/address/autocomplete?q=12+Main");
    request.nextUrl = new URL(request.url);
    const response = await route.GET(request);

    assert.equal(response.status, 429);
    assert.equal(lockAttempts, 0, "a limited visitor must not touch the shared lock");
    const limiter = used[0];
    const share = windowPerMinute(limiter.window) / SHARED_LOCK_REQUESTS_PER_MINUTE;
    assert.ok(share <= 0.25, `one IP may take ${Math.round(share * 100)}% of the shared lock`);
  });
});
