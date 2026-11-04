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
    const access = source("src/lib/listingAnalyticsAccess.ts");
    const migration = source(
      "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
    );
    const fullChain = source(
      "tools/database-full-chain/scenarios/listing-domain-owner-mutations.mjs",
    );

    assert.match(access, /incrementPublicListingAnalytics/);
    assert.match(access, /withDbUserContext\(input\.viewerUserId/);
    assert.match(access, /grainline_listing_public_analytics_increment/);
    assert.match(
      migration,
      /CREATE FUNCTION public\.grainline_listing_public_analytics_increment\(\s*p_listing_id text,\s*p_event_kind text\s*\)/,
    );
    assert.match(migration, /current_setting\('app\.user_id', true\)/);
    assert.match(migration, /listing\."sellerId" <> actor_seller_id/);
    assert.match(migration, /listing\.status = 'ACTIVE'::public\."ListingStatus"/);
    assert.match(migration, /listing\."sellerPubliclyOrderable" = true/);
    assert.match(migration, /INSERT INTO public\."ListingViewDaily" AS daily/);
    assert.match(fullChain, /seller self-traffic must not increment analytics/);
    assert.match(fullChain, /signed-in public traffic must increment analytics/);
    assert.match(fullChain, /anonymous public traffic must increment analytics/);

    for (const [path, counter] of [
      ["src/app/api/listings/[id]/view/route.ts", "viewCount"],
      ["src/app/api/listings/[id]/click/route.ts", "clickCount"],
    ]) {
      const route = source(path);
      const capIndex = route.indexOf("claimListingAnalyticsDailyCap(");
      const authorityIndex = route.indexOf("incrementPublicListingAnalytics(");

      assert.match(route, /import \{ auth \} from "@clerk\/nextjs\/server"/);
      assert.match(route, /import \{ userIdByClerkId \} from "@\/lib\/userIdentityAccess"/);
      assert.match(route, /const \{ userId \} = await auth\(\)/);
      assert.match(route, /claimListingAnalyticsDailyCap\("(view|click)", id\)/);
      assert.ok(capIndex >= 0 && capIndex < authorityIndex, `${path} must check daily cap before DB writes`);
      assert.match(route, /const viewer = userId \? await userIdByClerkId\(prisma, userId\) : null/);
      assert.match(route, /if \(userId && !viewer\) return telemetryJson\(\{ ok: true, skipped: true \}\)/);
      assert.match(route, /const viewerUserId = viewer\?\.id \?\? null/);
      assert.match(route, /incrementPublicListingAnalytics\(\{/);
      assert.match(route, /viewerUserId,/);
      assert.doesNotMatch(route, /seller: \{ user: \{ clerkId:/);
      assert.doesNotMatch(route, /prisma\.\$transaction/);
      assert.doesNotMatch(route, /(?:prisma|tx)\.listing\./);
      assert.match(migration, new RegExp(`"${counter}" = listing\\."${counter}" \\+ CASE`));
    }
  });
});
