import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

class Ratelimit {
  static slidingWindow() {}
}

const { rateLimitResponse } = loadWithStubs("src/lib/ratelimit.ts", {
  "@upstash/ratelimit": { Ratelimit },
  "@upstash/redis": { Redis: class {} },
  "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
  "./httpStatus.ts": { HTTP_STATUS: { TOO_MANY_REQUESTS: 429 } },
});

async function message(msFromNow) {
  const response = rateLimitResponse(Date.now() + msFromNow, "Too many broadcasts.");
  assert.equal(response.status, 429);
  return (await response.json()).error;
}

describe("rate limit retry copy", () => {
  it("states long waits in days, not as a clock time", async () => {
    const hour = 3600000;
    assert.equal(await message(7 * 24 * hour - 60000), "Too many broadcasts. Try again in 7 days.");
    assert.equal(await message(30 * hour), "Too many broadcasts. Try again in 2 days.");
    assert.equal(await message(23.5 * hour), "Too many broadcasts. Try again in 1 day.");
  });

  it("keeps short waits in minutes and hours", async () => {
    assert.equal(await message(10 * 60000), "Too many broadcasts. Try again in 10 minutes.");
    assert.equal(await message(3 * 3600000), "Too many broadcasts. Try again in 3 hours.");
    assert.equal(await message(30000), "Too many broadcasts. Try again in a moment.");
  });
});
