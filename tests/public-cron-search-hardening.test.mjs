import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

function getMethodSource(path, method) {
  const text = source(path);
  const start = text.indexOf(`export async function ${method}`);
  assert.notEqual(start, -1, `${path} must define ${method}`);
  const rest = text.slice(start);
  const nextMethod = rest.search(/\nexport async function (GET|POST|PUT|PATCH|DELETE)\b/);
  return nextMethod === -1 ? rest : rest.slice(0, nextMethod);
}

function cronRoutes() {
  return execFileSync("find", ["src/app/api/cron", "-type", "f", "-name", "route.ts"], {
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
}

function apiRoutes() {
  return execFileSync("find", ["src/app/api", "-type", "f", "-name", "route.ts"], {
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
    const cspReportState = source("src/lib/cspReport.ts");
    const health = source("src/app/api/health/route.ts");

    assert.match(cspReport, /safeRateLimit\(cspReportRatelimit, getIP\(request\)\)/);
    assert.doesNotMatch(cspReport, /safeRateLimitOpen\(cspReportRatelimit/);
    assert.match(cspReport, /readBoundedText\(request, CSP_REPORT_BODY_MAX_BYTES\)/);
    assert.match(cspReport, /sanitizeCspReportForSentry/);
    assert.match(cspReport, /cspReportBreadcrumbData\(report\)/);
    assert.match(cspReport, /JSON\.stringify\(sanitizeCspReportForSentry\(report\), null, 2\)/);
    assert.doesNotMatch(cspReport, /JSON\.stringify\(report, null, 2\)/);
    assert.match(cspReportState, /checkout_surface/);

    assert.match(health, /safeRateLimitOpen\(healthRatelimit, getIP\(req\)\)/);
    assert.match(health, /isVerboseHealthRequest\(req, process\.env\.HEALTH_CHECK_TOKEN\)/);
    assert.match(health, /healthResponsePayload\(cachedHealth!, verbose, cached\)/);
    assert.match(health, /status: cachedHealth!\.ok \? HTTP_STATUS\.OK : HTTP_STATUS\.SERVICE_UNAVAILABLE/);
    assert.match(health, /"Cache-Control": "private, no-store, max-age=0"/);
    assert.match(health, /Vary: "Authorization, X-Health-Check-Token"/);
  });

  it("marks ops-health cron check-ins unhealthy when actionable issues exist", () => {
    const route = source("src/app/api/cron/ops-health/route.ts");

    assert.match(route, /deadEmailOutboxCount/);
    assert.match(route, /staleRunningCronRunCount/);
    assert.match(route, /partialFailureCronRunCount/);
    assert.match(route, /partialCronRunIssueCount/);
    assert.match(route, /cronRunPartialIssueSummary/);
    assert.match(route, /status:\s*"RUNNING"/);
    assert.match(route, /status:\s*"COMPLETED"/);
    assert.match(route, /startedAt:\s*\{\s*lt: staleCronRunningBefore\s*\}/);
    assert.match(route, /status:\s*response\.ok \? HTTP_STATUS\.OK : HTTP_STATUS\.SERVICE_UNAVAILABLE/);
  });

  it("keeps dev-only order fixtures disabled outside local development", () => {
    const route = source("src/app/api/dev/make-order/route.ts");

    assert.match(route, /process\.env\.NODE_ENV === "development"/);
    assert.match(route, /process\.env\.VERCEL !== "1"/);
    assert.match(route, /process\.env\.VERCEL_ENV === undefined/);
    assert.match(route, /process\.env\.ENABLE_DEV_MAKE_ORDER === "true"/);
    assert.doesNotMatch(route, /process\.env\.NODE_ENV !== "production"/);
    assert.doesNotMatch(route, /!process\.env\.VERCEL_ENV/);
  });

  it("keeps CI on read-only repository permissions and blocking high audits", () => {
    const workflow = source(".github/workflows/ci.yml");
    const docs = source("CLAUDE.md");

    assert.match(workflow, /permissions:\s*\n\s+contents: read/);
    assert.match(workflow, /UPLOAD_VERIFICATION_SECRET: ci-upload-verification-secret/);
    assert.match(workflow, /HEALTH_CHECK_TOKEN: ci-health-check-token/);
    assert.match(workflow, /EMAIL_OUTBOX_DAILY_LIMIT: "100"/);
    assert.match(workflow, /npm audit --audit-level=high/);
    assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
    assert.match(docs, /High-severity dependency advisories are blocking/);
  });

  it("keeps fail-open rate limits limited to telemetry and diagnostics", () => {
    const allowedFailOpenRoutes = new Set([
      "src/app/api/csp-report/route.ts",
      "src/app/api/health/route.ts",
      "src/app/api/listings/[id]/click/route.ts",
      "src/app/api/listings/[id]/view/route.ts",
      "src/app/api/seller/[id]/view/route.ts",
    ]);

    for (const path of apiRoutes()) {
      const route = source(path);
      if (!route.includes("safeRateLimitOpen(")) continue;
      assert.ok(
        allowedFailOpenRoutes.has(path),
        `${path} should not fail open unless it is telemetry or diagnostics`,
      );
    }

    const ratelimit = source("src/lib/ratelimit.ts");
    const auditLog = source("docs/security-audit-log.md");
    assert.doesNotMatch(ratelimit, /support\/data request forms/);
    assert.doesNotMatch(auditLog, /support\/legal data-request stay fail-open/);
  });

  it("keeps public blog and search APIs rate-limited and visibility-scoped", () => {
    const blog = source("src/app/api/blog/route.ts");
    const blogSearch = source("src/app/api/blog/search/route.ts");
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");
    const globalSuggestions = source("src/app/api/search/suggestions/route.ts");
    const blogPage = source("src/app/blog/page.tsx");
    const popularTagsRoute = source("src/app/api/search/popular-tags/route.ts");
    const popularBlogTagsRoute = source("src/app/api/search/popular-blog-tags/route.ts");
    const popularBlogTags = source("src/lib/popularBlogTags.ts");
    const similarListings = source("src/app/api/listings/[id]/similar/route.ts");

    assert.match(blog, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blog, /rateLimitResponse\(reset, "Too many blog requests\."\)/);
    assert.match(blog, /truncateText\(searchParams\.get\("tag"\)\?\.trim\(\) \?\? "", 64\)/);
    assert.match(blog, /publicBlogPostWhere/);
    assert.match(blog, /parseBoundedPositiveIntParam\(searchParams\.get\("page"\), 1, 1000\)/);
    assert.match(blog, /const pageSize = 12/);

    assert.match(blogSearch, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blogSearch, /publicBlogPostWhere/);
    assert.match(blogSearch, /parseBoundedPositiveIntParam/);
    assert.match(blogSearch, /const page = parseBoundedPositiveIntParam\(url\.searchParams\.get\("page"\), 1, 1000\)/);
    assert.match(blogSearch, /const limit = parseBoundedPositiveIntParam\(url\.searchParams\.get\("limit"\), 12, 50\)/);
    assert.match(blogSearch, /normalizeTags\(tagsParam\.split\(","\), 20\)/);
    assert.match(blogSearch, /bp\."publishedAt" IS NOT NULL/);
    assert.match(blogSearch, /bp\."publishedAt" <= NOW\(\)/);
    assert.doesNotMatch(blogSearch, /x-forwarded-for/);

    assert.match(blogSuggestions, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(blogSuggestions, /normalizeSearchSuggestionQuery/);
    assert.match(blogSuggestions, /BLOG_FUZZY_SUGGESTION_MIN_SIMILARITY/);
    assert.match(blogSuggestions, /activeSellerProfileWhere/);
    assert.match(blogSuggestions, /bp\."publishedAt" IS NOT NULL/);
    assert.match(blogSuggestions, /bp\."publishedAt" <= NOW\(\)/);
    assert.doesNotMatch(blogSuggestions, /similarity\(bp\.title, \$\{q\}\) > 0\.2/);
    assert.doesNotMatch(blogSuggestions, /x-forwarded-for/);

    assert.match(globalSuggestions, /normalizeSearchSuggestionQuery/);
    assert.match(globalSuggestions, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(globalSuggestions, /getBlockedSellerProfileIdsFor/);
    assert.match(globalSuggestions, /publicListingWhere/);
    assert.match(globalSuggestions, /activeSellerProfileWhere/);
    assert.match(globalSuggestions, /bp\."publishedAt" IS NOT NULL/);
    assert.match(globalSuggestions, /bp\."publishedAt" <= NOW\(\)/);

    for (const route of [popularTagsRoute, popularBlogTagsRoute]) {
      assert.match(route, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
      assert.doesNotMatch(route, /safeRateLimitOpen\(searchRatelimit/);
    }
    assert.match(popularTagsRoute, /rateLimitResponse\(reset, "Too many popular-search requests\."\)/);
    assert.match(popularBlogTagsRoute, /rateLimitResponse\(reset, "Too many popular-blog-topic requests\."\)/);

    assert.match(blogPage, /"BlogPost"\."publishedAt" IS NOT NULL/);
    assert.match(blogPage, /"BlogPost"\."publishedAt" <= NOW\(\)/);
    assert.match(blogPage, /getPopularBlogTagRows\(20\)/);
    assert.match(popularBlogTags, /bp\."publishedAt" IS NOT NULL/);
    assert.match(popularBlogTags, /bp\."publishedAt" <= NOW\(\)/);

    assert.match(similarListings, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(similarListings, /rateLimitResponse\(rate\.reset, "Too many similar-listing requests\."\)/);
    assert.match(similarListings, /publicListingWhere\(\{ id \}\)/);
    assert.match(similarListings, /getBlockedSellerProfileIdsFor/);
    assert.match(similarListings, /l\."sellerId" != ALL\(\$\{blockedSellerIds\}\)/);
    assert.match(similarListings, /me\?\.banned \|\| me\?\.deletedAt/);
    assert.match(similarListings, /sp\."stripeAccountVersion" IS NULL OR sp\."stripeAccountVersion" = 'v2'/);
  });

  it("keeps public commission reads bounded and rate-limited", () => {
    const commission = source("src/app/api/commission/route.ts");
    const commissionDetail = getMethodSource("src/app/api/commission/[id]/route.ts", "GET");

    assert.match(commission, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(commission, /rateLimitResponse\(rate\.reset, "Too many commission requests\."\)/);
    assert.match(commission, /parseBoundedPositiveIntParam\(url\.searchParams\.get\("page"\), 1, 1000\)/);
    assert.match(commission, /openCommissionWhere/);
    assert.match(commission, /const currentPage = Math\.min\(page, Math\.max\(1, Math\.ceil\(total \/ pageSize\)\)\)/);
    assert.match(commission, /orderBy: \[\{ createdAt: "desc" \}, \{ id: "asc" \}\]/);
    assert.match(commission, /skip: \(currentPage - 1\) \* pageSize/);
    assert.match(commissionDetail, /safeRateLimit\(searchRatelimit, getIP\(req\)\)/);
    assert.match(commissionDetail, /rateLimitResponse\(reset, "Too many commission reads\."\)/);
    assert.match(commissionDetail, /where: openCommissionWhere\(\{[\s\S]*id,[\s\S]*buyerId: \{ notIn: \[\.\.\.blockedUserIds\] \}/);
    assert.doesNotMatch(commissionDetail, /prisma\.commissionRequest\.findUnique\(\{\s*where: \{ id \}/);
  });

  it("keeps blog suggestions filtered by viewer block state", () => {
    const blogSuggestions = source("src/app/api/blog/search/suggestions/route.ts");

    assert.match(blogSuggestions, /ensureUserByClerkId\(userId\)/);
    assert.match(blogSuggestions, /getBlockedIdsFor\(meDbId\)/);
    assert.match(blogSuggestions, /bp\."authorId" != ALL\(\$\{blockedUserIds\}\)/);
    assert.match(blogSuggestions, /bp\."sellerProfileId" != ALL\(\$\{blockedSellerIds\}\)/);
    assert.match(blogSuggestions, /id: \{ notIn: blockedSellerIds \}/);
  });

  it("keeps checkout rollback scoped to the signed-in buyer and idempotent stock restore", () => {
    const rollback = source("src/app/api/cart/checkout/rollback/route.ts");

    assert.match(rollback, /import \{ HTTP_STATUS \} from "@\/lib\/httpStatus"/);
    assert.match(rollback, /ensureUserByClerkId\(userId\)/);
    assert.match(rollback, /safeRateLimit\(cartMutationRatelimit, me\.id\)/);
    assert.match(rollback, /status: HTTP_STATUS\.UNAUTHORIZED/);
    assert.match(rollback, /status: HTTP_STATUS\.PAYLOAD_TOO_LARGE/);
    assert.match(rollback, /status: HTTP_STATUS\.BAD_REQUEST/);
    assert.match(rollback, /status: HTTP_STATUS\.INTERNAL_SERVER_ERROR/);
    assert.match(rollback, /metadata\.buyerId !== me\.id/);
    assert.match(rollback, /reason: "not_found"/);
    assert.match(rollback, /source: "cart_checkout_rollback_retrieve"/);
    assert.match(rollback, /reason: "retrieve_failed"/);
    assert.match(rollback, /stripe\.checkout\.sessions\.expire\(sessionId\)/);
    assert.match(rollback, /restoreUnorderedCheckoutStockOnce/);
    assert.match(rollback, /source: "cart_checkout_rollback_expire"/);
    assert.match(rollback, /source: "cart_checkout_rollback_restore"/);
  });
});
