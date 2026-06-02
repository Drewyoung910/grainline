import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("listing analytics guardrails", () => {
  it("keeps public listing view and click IP windows tightened", () => {
    const ratelimit = source("src/lib/ratelimit.ts");

    assert.match(ratelimit, /export const viewRatelimit = new Ratelimit\(\{\s*redis,\s*limiter: Ratelimit\.slidingWindow\(10, "60 s"\)/s);
    assert.match(ratelimit, /export const clickRatelimit = new Ratelimit\(\{\s*redis,\s*limiter: Ratelimit\.slidingWindow\(10, "60 s"\)/s);
    assert.match(ratelimit, /export const LISTING_VIEW_DAILY_ANALYTICS_CAP = 5_000/);
    assert.match(ratelimit, /export const LISTING_CLICK_DAILY_ANALYTICS_CAP = 1_000/);
  });

  it("uses fail-open per-listing daily caps with bounded Sentry context", () => {
    const ratelimit = source("src/lib/ratelimit.ts");

    assert.match(ratelimit, /export function listingAnalyticsDailyCapKey/);
    assert.match(ratelimit, /rl:listing-analytics-daily:\$\{kind\}:\$\{todayUtcKeyPart\(date\)\}:\$\{listingId\}/);
    assert.match(ratelimit, /export async function claimListingAnalyticsDailyCap/);
    assert.match(ratelimit, /const count = Number\(await redis\.incr\(key\)\)/);
    assert.match(ratelimit, /await redis\.expire\(key, LISTING_ANALYTICS_DAILY_CAP_TTL_SECONDS\)/);
    assert.match(ratelimit, /return count <= listingAnalyticsDailyCap\(kind\)/);
    assert.match(ratelimit, /source: "listing_analytics_daily_cap"/);
    assert.match(ratelimit, /return true/);
    const capFailureCapture = ratelimit.slice(
      ratelimit.indexOf('source: "listing_analytics_daily_cap"'),
      ratelimit.indexOf("/** Returns the client IP"),
    );
    assert.match(capFailureCapture, /extra: \{ listingId \}/);
    assert.doesNotMatch(capFailureCapture, /userAgent|headers|cookie|url/);
  });

  it("skips signed-in seller self-traffic before listing analytics counters are written", () => {
    for (const [path, counter] of [
      ["src/app/api/listings/[id]/view/route.ts", "viewCount"],
      ["src/app/api/listings/[id]/click/route.ts", "clickCount"],
    ]) {
      const route = source(path);
      const capIndex = route.indexOf("claimListingAnalyticsDailyCap(");
      const transactionIndex = route.indexOf("prisma.$transaction");

      assert.match(route, /import \{ auth \} from "@clerk\/nextjs\/server"/);
      assert.match(route, /const \{ userId \} = await auth\(\)/);
      assert.match(route, /claimListingAnalyticsDailyCap\("(view|click)", id\)/);
      assert.ok(capIndex >= 0 && capIndex < transactionIndex, `${path} must check daily cap before DB writes`);
      assert.match(route, /seller: \{ user: \{ clerkId: \{ not: userId \} \} \}/);
      assert.match(route, new RegExp(`data: \\{ ${counter}: \\{ increment: 1 \\} \\}`));
      assert.match(route, /publicListingWhere\(\{/);
    }
  });
});
