import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  PRIVATE_JSON_CACHE_CONTROL,
  PRIVATE_JSON_VARY,
  privateJson,
  privateResponse,
} = await import("../src/lib/privateResponse.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

function getMethodSource(path, method) {
  const text = source(path);
  const start = text.indexOf(`export async function ${method}`);
  assert.notEqual(start, -1, `${path} must define ${method}`);
  const rest = text.slice(start);
  const nextMethod = rest.search(
    /\nexport async function (GET|POST|PUT|PATCH|DELETE)\b/,
  );
  return nextMethod === -1 ? rest : rest.slice(0, nextMethod);
}

function getHandlerSource(path) {
  return getMethodSource(path, "GET");
}

describe("private JSON cache headers", () => {
  it("sets no-store cache control and Vary: Cookie on private JSON responses", async () => {
    const response = privateJson({ ok: true });

    assert.equal(
      response.headers.get("cache-control"),
      PRIVATE_JSON_CACHE_CONTROL,
    );
    assert.equal(response.headers.get("vary"), PRIVATE_JSON_VARY);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("preserves existing response headers when marking rate-limit responses private", () => {
    const response = new Response(JSON.stringify({ error: "rate limited" }), {
      status: 429,
      headers: {
        "Retry-After": "30",
        Vary: "Accept-Encoding",
      },
    });

    privateResponse(response);

    assert.equal(
      response.headers.get("cache-control"),
      PRIVATE_JSON_CACHE_CONTROL,
    );
    assert.equal(response.headers.get("retry-after"), "30");
    assert.equal(response.headers.get("vary"), "Accept-Encoding, Cookie");
  });

  it("keeps account access errors and account exports on private response headers", () => {
    const accountAccess = source("src/lib/apiAccountAccess.ts");
    const accountExportFormat = source("src/lib/accountExportFormat.ts");

    assert.match(accountAccess, /privateJson\(payload\.body/);
    assert.match(accountExportFormat, /PRIVATE_JSON_CACHE_CONTROL/);
    assert.match(accountExportFormat, /PRIVATE_JSON_VARY/);
  });

  it("keeps user-specific JSON read routes behind private response helpers", () => {
    const routes = [
      "src/app/api/me/route.ts",
      "src/app/api/cart/route.ts",
      "src/app/api/notifications/route.ts",
      "src/app/api/account/feed/route.ts",
      "src/app/api/account/export/route.ts",
      "src/app/api/account/notifications/preferences/route.ts",
      "src/app/api/account/shipping-address/route.ts",
      "src/app/api/stripe/connect/status/route.ts",
      "src/app/api/seller/analytics/route.ts",
      "src/app/api/seller/analytics/recent-sales/route.ts",
      "src/app/api/messages/[id]/list/route.ts",
      "src/app/api/messages/unread-count/route.ts",
      "src/app/api/listings/recently-viewed/route.ts",
      "src/app/api/search/saved/route.ts",
      "src/app/api/blog/[slug]/save/route.ts",
      "src/app/api/search/suggestions/route.ts",
      "src/app/api/listings/[id]/similar/route.ts",
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/stripe/connect/dashboard/route.ts",
      "src/app/api/stripe/connect/login-link/route.ts",
      "src/app/api/upload/presign/route.ts",
      "src/app/api/upload/verify/route.ts",
      "src/app/api/upload/image/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/shipping/quote/route.ts",
    ];

    for (const route of routes) {
      const text = source(route);
      assert.match(
        text,
        /@\/lib\/privateResponse/,
        `${route} should import private response helpers`,
      );
      assert.doesNotMatch(
        text,
        /\b(?:NextResponse|Response)\.json\(/,
        `${route} should not return bare JSON`,
      );
    }
  });

  it("keeps private wrappers around retryable auth route failures", () => {
    for (const route of [
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/stripe/connect/dashboard/route.ts",
      "src/app/api/stripe/connect/login-link/route.ts",
      "src/app/api/upload/presign/route.ts",
      "src/app/api/upload/verify/route.ts",
      "src/app/api/upload/image/route.ts",
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/delete/route.ts",
      "src/app/api/cart/update/route.ts",
      "src/app/api/shipping/quote/route.ts",
      "src/app/api/verification/apply/route.ts",
      "src/app/api/cases/route.ts",
      "src/app/api/cases/[id]/messages/route.ts",
      "src/app/api/cases/[id]/escalate/route.ts",
      "src/app/api/cases/[id]/mark-resolved/route.ts",
      "src/app/api/cases/[id]/resolve/route.ts",
      "src/app/api/commission/[id]/interest/route.ts",
      "src/app/api/orders/[id]/refund/route.ts",
      "src/app/api/orders/[id]/label/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/reviews/[id]/vote/route.ts",
      "src/app/api/listings/[id]/stock/route.ts",
      "src/app/api/seller/vacation/route.ts",
      "src/app/api/users/[id]/report/route.ts",
      "src/app/api/orders/[id]/fulfillment/route.ts",
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
      "src/app/api/follow/[sellerId]/route.ts",
      "src/app/api/seller/broadcast/route.ts",
      "src/app/api/cart/checkout/rollback/route.ts",
    ]) {
      const text = source(route);

      assert.match(
        text,
        /privateResponse\(\s*rateLimitResponse\(/,
        `${route} should preserve rate-limit headers as private`,
      );
    }

    for (const route of [
      "src/app/api/upload/presign/route.ts",
      "src/app/api/upload/image/route.ts",
    ]) {
      const text = source(route);

      assert.match(
        text,
        /privateJson\(failure\.body, failure\.init\)/,
        `${route} should preserve upload retry headers as private`,
      );
    }
  });

  it("keeps selected auth mutation routes behind private response helpers", () => {
    const routes = [
      "src/app/api/cart/add/route.ts",
      "src/app/api/notifications/read-all/route.ts",
      "src/app/api/notifications/[id]/read/route.ts",
      "src/app/api/users/[id]/block/route.ts",
      "src/app/api/favorites/route.ts",
      "src/app/api/favorites/[listingId]/route.ts",
      "src/app/api/listings/[id]/notify/route.ts",
      "src/app/api/messages/[id]/read/route.ts",
      "src/app/api/messages/custom-order-request/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/account/accept-terms/route.ts",
      "src/app/api/account/delete/route.ts",
      "src/app/api/cart/update/route.ts",
      "src/app/api/shipping/quote/route.ts",
      "src/app/api/verification/apply/route.ts",
      "src/app/api/cases/route.ts",
      "src/app/api/cases/[id]/messages/route.ts",
      "src/app/api/cases/[id]/escalate/route.ts",
      "src/app/api/cases/[id]/mark-resolved/route.ts",
      "src/app/api/cases/[id]/resolve/route.ts",
      "src/app/api/commission/[id]/interest/route.ts",
      "src/app/api/orders/[id]/refund/route.ts",
      "src/app/api/orders/[id]/label/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/reviews/[id]/vote/route.ts",
      "src/app/api/listings/[id]/stock/route.ts",
      "src/app/api/seller/vacation/route.ts",
      "src/app/api/users/[id]/report/route.ts",
      "src/app/api/orders/[id]/fulfillment/route.ts",
      "src/app/api/orders/[id]/confirm-delivery/route.ts",
      "src/app/api/follow/[sellerId]/route.ts",
      "src/app/api/seller/broadcast/route.ts",
      "src/app/api/cart/checkout/rollback/route.ts",
    ];

    for (const route of routes) {
      const text = source(route);
      assert.match(
        text,
        /@\/lib\/privateResponse/,
        `${route} should import private response helpers`,
      );
      assert.match(
        text,
        /privateJson/,
        `${route} should use privateJson for JSON responses`,
      );
      assert.doesNotMatch(
        text,
        /\b(?:NextResponse|Response)\.json\(/,
        `${route} should not return bare JSON`,
      );
      assert.doesNotMatch(
        text,
        /return rateLimitResponse\(/,
        `${route} should not return bare rate-limit JSON`,
      );
    }
  });

  it("keeps auth mutation methods private when the same route file also has public handlers", () => {
    const commissionCreate = getMethodSource("src/app/api/commission/route.ts", "POST");
    const commissionStatus = getMethodSource("src/app/api/commission/[id]/route.ts", "PATCH");

    for (const methodSource of [commissionCreate, commissionStatus]) {
      assert.match(methodSource, /privateJson/);
      assert.match(methodSource, /privateResponse\(\s*rateLimitResponse\(/);
      assert.doesNotMatch(methodSource, /\b(?:NextResponse|Response)\.json\(/);
      assert.doesNotMatch(methodSource, /return rateLimitResponse\(/);
    }

    const commissionList = getMethodSource("src/app/api/commission/route.ts", "GET");
    const commissionDetail = getMethodSource("src/app/api/commission/[id]/route.ts", "GET");
    assert.match(commissionList, /NextResponse\.json/);
    assert.match(commissionDetail, /NextResponse\.json/);
  });

  it("keeps auth-varying GET handlers private even when other methods stay unchanged", () => {
    const followGet = getHandlerSource(
      "src/app/api/follow/[sellerId]/route.ts",
    );
    const broadcastGet = getHandlerSource(
      "src/app/api/seller/broadcast/route.ts",
    );

    assert.match(followGet, /privateJson/);
    assert.match(followGet, /privateResponse/);
    assert.doesNotMatch(followGet, /NextResponse\.json\(/);

    assert.match(broadcastGet, /privateJson/);
    assert.doesNotMatch(broadcastGet, /NextResponse\.json\(/);
  });

  it("marks authenticated message streams as private and cookie-varying", () => {
    const stream = source("src/app/api/messages/[id]/stream/route.ts");

    assert.match(stream, /privateJson\(\{ error: "Unauthorized" \}/);
    assert.match(
      stream,
      /"Cache-Control": "private, no-store, no-cache, no-transform, max-age=0"/,
    );
    assert.match(stream, /Vary: "Cookie"/);
  });
});
