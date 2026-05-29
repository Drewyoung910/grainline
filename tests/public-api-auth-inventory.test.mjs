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

const intentionalPublicRoutes = new Set([
  "src/app/api/address/autocomplete/route.ts",
  "src/app/api/blog/route.ts",
  "src/app/api/blog/search/route.ts",
  "src/app/api/blog/search/suggestions/route.ts",
  "src/app/api/csp-report/route.ts",
  "src/app/api/email/unsubscribe/route.ts",
  "src/app/api/health/route.ts",
  "src/app/api/legal/data-request/route.ts",
  "src/app/api/listings/[id]/click/route.ts",
  "src/app/api/listings/[id]/view/route.ts",
  "src/app/api/newsletter/route.ts",
  "src/app/api/search/popular-blog-tags/route.ts",
  "src/app/api/search/popular-tags/route.ts",
  "src/app/api/support/route.ts",
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

    assert.deepEqual(unauthenticatedRoutes, [...intentionalPublicRoutes].sort());
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
