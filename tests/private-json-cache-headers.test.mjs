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

function getHandlerSource(path) {
  const text = source(path);
  const start = text.indexOf("export async function GET");
  assert.notEqual(start, -1, `${path} must define GET`);
  const rest = text.slice(start);
  const nextMethod = rest.search(/\nexport async function (POST|PUT|PATCH|DELETE)\b/);
  return nextMethod === -1 ? rest : rest.slice(0, nextMethod);
}

describe("private JSON cache headers", () => {
  it("sets no-store cache control and Vary: Cookie on private JSON responses", async () => {
    const response = privateJson({ ok: true });

    assert.equal(response.headers.get("cache-control"), PRIVATE_JSON_CACHE_CONTROL);
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

    assert.equal(response.headers.get("cache-control"), PRIVATE_JSON_CACHE_CONTROL);
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
    ];

    for (const route of routes) {
      const text = source(route);
      assert.match(text, /@\/lib\/privateResponse/, `${route} should import private response helpers`);
      assert.doesNotMatch(text, /\b(?:NextResponse|Response)\.json\(/, `${route} should not return bare JSON`);
    }
  });

  it("keeps auth-varying GET handlers private even when other methods stay unchanged", () => {
    const followGet = getHandlerSource("src/app/api/follow/[sellerId]/route.ts");
    const broadcastGet = getHandlerSource("src/app/api/seller/broadcast/route.ts");

    assert.match(followGet, /privateJson/);
    assert.match(followGet, /privateResponse/);
    assert.doesNotMatch(followGet, /NextResponse\.json\(/);

    assert.match(broadcastGet, /privateJson/);
    assert.doesNotMatch(broadcastGet, /NextResponse\.json\(/);
  });

  it("marks authenticated message streams as private and cookie-varying", () => {
    const stream = source("src/app/api/messages/[id]/stream/route.ts");

    assert.match(stream, /privateJson\(\{ error: "Unauthorized" \}/);
    assert.match(stream, /"Cache-Control": "private, no-store, no-cache, no-transform, max-age=0"/);
    assert.match(stream, /Vary: "Cookie"/);
  });
});
