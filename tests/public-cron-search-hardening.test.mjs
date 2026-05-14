import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function cronRoutes() {
  return execFileSync("find", ["src/app/api/cron", "-type", "f", "-name", "route.ts"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
}

describe("cron and public route hardening", () => {
  it("keeps every cron route behind shared bearer-token auth and cron-run state", () => {
    for (const path of cronRoutes()) {
      const route = source(path);
      assert.match(route, /verifyCronRequest/);
      assert.match(route, /withSentryCronMonitor/);
      assert.match(route, /beginCronRun/);
      assert.match(route, /completeCronRun/);
      assert.match(route, /failCronRun/);
      assert.match(route, /skippedCronRunResponse/);
      assert.match(route, /Unauthorized/);
    }

    const cronAuth = source("src/lib/cronAuth.ts");
    assert.match(cronAuth, /timingSafeEqual/);
    assert.match(cronAuth, /CRON_SECRET_PREVIOUS/);
    assert.match(cronAuth, /sha256/);
  });

  it("keeps CSP reports and health checks bounded before exposing diagnostics", () => {
    const cspReport = source("src/app/api/csp-report/route.ts");
    const health = source("src/app/api/health/route.ts");

    assert.match(cspReport, /safeRateLimitOpen\(cspReportRatelimit, getIP\(request\)\)/);
    assert.match(cspReport, /sanitizeCspReportForSentry/);
    assert.match(cspReport, /checkout_surface/);

    assert.match(health, /safeRateLimitOpen\(healthRatelimit, getIP\(req\)\)/);
    assert.match(health, /isVerboseHealthRequest\(req\.url, process\.env\.HEALTH_CHECK_TOKEN\)/);
    assert.match(health, /healthResponsePayload\(cachedHealth!, verbose, cached\)/);
  });

  it("keeps public blog and search APIs rate-limited and visibility-scoped", () => {
    const blog = source("src/app/api/blog/route.ts");
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    const globalSuggestions = source("src/app/api/search/suggestions/route.ts");

    assert.match(blog, /safeRateLimitOpen\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blog, /rateLimitResponse\(reset, "Too many blog requests\."\)/);
    assert.match(blog, /truncateText\(searchParams\.get\("tag"\)\?\.trim\(\) \?\? "", 64\)/);
    assert.match(blog, /publicBlogPostWhere/);
    assert.match(blog, /Math\.min\(1000/);
    assert.match(blog, /const pageSize = 12/);

    assert.match(blogSearch, /safeRateLimitOpen\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blogSearch, /publicBlogPostWhere/);
    assert.doesNotMatch(blogSearch, /x-forwarded-for/);

    assert.match(blogSuggestions, /safeRateLimitOpen\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blogSuggestions, /activeSellerProfileWhere/);
    assert.doesNotMatch(blogSuggestions, /x-forwarded-for/);

    assert.match(globalSuggestions, /normalizeSearchSuggestionQuery/);
    assert.match(globalSuggestions, /getBlockedSellerProfileIdsFor/);
    assert.match(globalSuggestions, /publicListingWhere/);
    assert.match(globalSuggestions, /activeSellerProfileWhere/);
  });

  it("keeps checkout rollback scoped to the signed-in buyer and idempotent stock restore", () => {
    const rollback = source("src/app/api/cart/checkout/rollback/route.ts");

    assert.match(rollback, /ensureUserByClerkId\(userId\)/);
    assert.match(rollback, /safeRateLimit\(cartMutationRatelimit, me\.id\)/);
    assert.match(rollback, /metadata\.buyerId !== me\.id/);
    assert.match(rollback, /stripe\.checkout\.sessions\.expire\(sessionId\)/);
    assert.match(rollback, /restoreUnorderedCheckoutStockOnce/);
    assert.match(rollback, /source: "cart_checkout_rollback_expire"/);
    assert.match(rollback, /source: "cart_checkout_rollback_restore"/);
  });
});
