import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function apiRoutes() {
  return execFileSync("find", ["src/app/api", "-type", "f", "-name", "route.ts"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean).sort();
}

const intentionalNoAuthPublicRoutes = new Set([
  "src/app/api/address/autocomplete/route.ts",
  "src/app/api/csp-report/route.ts",
  "src/app/api/email/unsubscribe/route.ts",
  "src/app/api/health/route.ts",
  // Temporary, Preview-only RLS context acceptance runner. The route is
  // environment-, commit-, token-, and two-slot-ledger-gated and is removed
  // before the production runtime-role release.
  "src/app/api/internal/rls-context-gate/route.ts",
  // Temporary, Preview-only real-table route fixture. Commit- and token-pinned;
  // removed before the reviewed Phase-A production artifact.
  "src/app/api/internal/saved-search-route-fixture/route.ts",
  "src/app/api/legal/data-request/route.ts",
  "src/app/api/newsletter/confirm/route.ts",
  "src/app/api/newsletter/route.ts",
  "src/app/api/search/popular-blog-tags/route.ts",
  "src/app/api/search/popular-tags/route.ts",
  // Map marker popup card — public non-viewer-specific seller snapshot,
  // gated by activeSellerProfileWhere + publicMapOptIn, IP rate limited.
  "src/app/api/seller/[id]/map-card/route.ts",
  "src/app/api/support/route.ts",
]);

const intentionalOptionalAuthPublicRoutes = new Set([
  "src/app/api/listings/[id]/click/route.ts",
  "src/app/api/listings/[id]/view/route.ts",
]);

const intentionalOptionalAccountAuthPublicRoutes = new Set([
  "src/app/api/blog/route.ts",
  "src/app/api/blog/search/route.ts",
  "src/app/api/blog/search/suggestions/route.ts",
]);

const intentionalPublicRoutes = new Set([
  ...intentionalNoAuthPublicRoutes,
  ...intentionalOptionalAuthPublicRoutes,
  ...intentionalOptionalAccountAuthPublicRoutes,
]);

describe("public API auth inventory", () => {
  it("keeps no-auth API routes limited to the intentional public allowlist", () => {
    const unauthenticatedRoutes = apiRoutes().filter((path) => {
      const route = source(path);
      return ![
        "auth()",
        "ensureUser",
        "ensureSeller",
        "verifyCronRequest",
        "constructEvent",
        "parseEventNotification",
        "webhooks.verify",
        "Webhook",
      ].some((needle) => route.includes(needle));
    });

    assert.deepEqual(unauthenticatedRoutes, [...intentionalNoAuthPublicRoutes].sort());
  });

  it("keeps optional-auth public routes limited to routes that still allow signed-out callers", () => {
    for (const path of intentionalOptionalAuthPublicRoutes) {
      const route = source(path);

      assert.match(route, /const \{ userId \} = await auth\(\)/);
      assert.doesNotMatch(route, /if \s*\(!userId\)/);
      assert.doesNotMatch(route, /ensureUser|ensureSeller|verifyCronRequest/);
      assert.match(route, /telemetryJson\(\{ ok: true/);
      assert.match(route, /privateResponse\(NextResponse\.json\(body\)\)/);
    }
  });

  it("keeps optional account-auth public routes limited to signed-in visibility filters", () => {
    for (const path of intentionalOptionalAccountAuthPublicRoutes) {
      const route = source(path);

      assert.match(route, /const \{ userId \} = await auth\(\)/);
      assert.doesNotMatch(route, /if \s*\(!userId\)/);
      assert.match(route, /ensureUserByClerkId\(userId\)/);
      assert.match(route, /accountAccessErrorResponse\(err\)/);
      assert.match(route, /getBlockedIdsFor\(meDbId\)/);
      assert.doesNotMatch(route, /ensureSeller|verifyCronRequest/);
    }
  });

  it("keeps public unauthenticated Prisma/raw-SQL routes rate-limited or statically cached", () => {
    for (const path of intentionalPublicRoutes) {
      const route = source(path);
      const doesDbWork = route.includes("prisma.") || route.includes("$queryRaw") || route.includes("getPopular");
      if (!doesDbWork) continue;

      assert.ok(
        route.includes("safeRateLimit(") ||
          route.includes("safeRateLimitOpen(") ||
          route.includes("export const revalidate = 3600") ||
          (
            route.includes('export const dynamic = "force-dynamic"') &&
            route.includes("underlying tag helper owns caching")
          ),
        `${path} should rate-limit or statically cache public DB work`,
      );
    }
  });
});
