import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

function loadRoute(kind, {
  bot = false,
  rateLimitResults = [true, true],
  tracking = { hasTracked: false, hasLegacyCookie: false, aggregateIds: [] },
  dailyCapAllowed = true,
  userId = null,
  viewer = null,
  recorded = true,
} = {}) {
  const calls = {
    authority: [],
    cap: [],
    cookies: 0,
    identity: [],
    rateLimit: [],
    sequence: [],
    setCookie: [],
  };
  let rateLimitIndex = 0;
  const routePath = `src/app/api/listings/[id]/${kind}/route.ts`;
  const dependencies = {
    "next/server": {
      NextResponse: {
        json(body, init) {
          const response = Response.json(body, init);
          Object.defineProperty(response, "cookies", { value: {} });
          return response;
        },
      },
    },
    "@clerk/nextjs/server": {
      auth: async () => ({ userId }),
    },
    "next/headers": {
      cookies: async () => {
        calls.sequence.push("cookies");
        calls.cookies += 1;
        return {};
      },
    },
    "@/lib/db": { prisma: {} },
    "@/lib/ratelimit": {
      claimListingAnalyticsDailyCap: async (metricKind, listingId) => {
        calls.sequence.push("daily-cap");
        calls.cap.push({ kind: metricKind, listingId });
        return dailyCapAllowed;
      },
      clickDedupRatelimit: { name: "click-dedup" },
      clickRatelimit: { name: "click-global" },
      getIP: () => "203.0.113.1",
      profileViewRatelimit: { name: "view-dedup" },
      safeRateLimitOpen: async (limiter, key) => {
        calls.sequence.push(`rate-limit:${limiter.name}`);
        calls.rateLimit.push({ limiter: limiter.name, key });
        const success = rateLimitResults[rateLimitIndex] ?? true;
        rateLimitIndex += 1;
        return { success };
      },
      viewRatelimit: { name: "view-global" },
    },
    "@/lib/listingTrackingCookies": {
      hasTrackingCookie: () => tracking,
      setTrackingCookie: (_cookies, aggregateName, aggregateIds, listingId, legacyName) => {
        calls.sequence.push("set-cookie");
        calls.setCookie.push({ aggregateName, aggregateIds, listingId, legacyName });
      },
    },
    "@/lib/botUserAgent": {
      isLikelyBotUserAgent: () => bot,
    },
    "@/lib/privateResponse": {
      privateResponse: (response) => response,
    },
    "@/lib/userIdentityAccess": {
      userIdByClerkId: async (_client, clerkId) => {
        calls.sequence.push("identity");
        calls.identity.push(clerkId);
        return viewer;
      },
    },
    "@/lib/sellerAnalyticsDailyAccess": {
      recordListingAnalytics: async (listingId, metricKind, viewerUserId) => {
        calls.sequence.push("authority");
        calls.authority.push({ listingId, kind: metricKind, viewerUserId });
        return recorded;
      },
    },
  };
  const { outputText } = ts.transpileModule(readFileSync(routePath, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const routeModule = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected dependency ${name}`);
    return dependencies[name];
  }, routeModule, routeModule.exports);
  return { route: routeModule.exports, calls };
}

function request(kind) {
  return new Request(`http://localhost/api/listings/listing_1/${kind}`, {
    method: "POST",
    headers: { "user-agent": "Grainline route behavior test" },
  });
}

const context = { params: Promise.resolve({ id: "listing_1" }) };

for (const kind of ["view", "click"]) {
  test(`${kind} route runs abuse controls before the actor-bound analytics authority`, async () => {
    const loaded = loadRoute(kind, {
      userId: "clerk_viewer",
      viewer: { id: "database_viewer" },
    });
    const response = await loaded.route.POST(request(kind), context);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(loaded.calls.authority, [{
      listingId: "listing_1",
      kind,
      viewerUserId: "database_viewer",
    }]);
    assert.deepEqual(loaded.calls.cap, [{ kind, listingId: "listing_1" }]);
    assert.deepEqual(loaded.calls.identity, ["clerk_viewer"]);
    assert.equal(loaded.calls.rateLimit.length, 2);
    assert.equal(loaded.calls.cookies, 1);
    assert.equal(loaded.calls.setCookie.length, 1);
    assert.ok(
      loaded.calls.sequence.indexOf("daily-cap")
        < loaded.calls.sequence.indexOf("authority"),
    );
    assert.ok(
      loaded.calls.sequence.indexOf("identity")
        < loaded.calls.sequence.indexOf("authority"),
    );
  });

  for (const [label, options] of [
    ["bots", { bot: true }],
    ["global rate limits", { rateLimitResults: [false] }],
    ["per-listing dedup limits", { rateLimitResults: [true, false] }],
    ["tracking cookies", {
      tracking: { hasTracked: true, hasLegacyCookie: false, aggregateIds: ["listing_1"] },
    }],
    ["daily caps", { dailyCapAllowed: false }],
    ["missing signed-in identities", { userId: "clerk_missing", viewer: null }],
  ]) {
    test(`${kind} route rejects ${label} before analytics authority work`, async () => {
      const loaded = loadRoute(kind, options);
      const response = await loaded.route.POST(request(kind), context);
      assert.equal(response.status, 200);
      assert.deepEqual(loaded.calls.authority, []);
      assert.equal((await response.json()).ok, true);
    });
  }

  test(`${kind} route does not write its tracking cookie when the database skips`, async () => {
    const loaded = loadRoute(kind, { recorded: false });
    const response = await loaded.route.POST(request(kind), context);
    assert.deepEqual(await response.json(), { ok: true, skipped: true });
    assert.equal(loaded.calls.authority.length, 1);
    assert.deepEqual(loaded.calls.setCookie, []);
  });
}
