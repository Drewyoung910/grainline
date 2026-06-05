import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  assertAdminPinCookieSecretConfigured,
  createAdminPinSessionCookieValue,
  verifyAdminPinCookieValue,
} = await import("../src/lib/adminPin.ts");

describe("admin PIN cookie secret configuration", () => {
  it("allows production when a dedicated cookie secret is configured", () => {
    assert.doesNotThrow(() =>
      assertAdminPinCookieSecretConfigured({
        NODE_ENV: "production",
        ADMIN_PIN_COOKIE_SECRET: "test-cookie-secret",
      }),
    );
  });

  it("fails production startup when the cookie secret is missing", () => {
    assert.throws(
      () => assertAdminPinCookieSecretConfigured({ NODE_ENV: "production" }),
      /ADMIN_PIN_COOKIE_SECRET is required in production/,
    );
  });

  it("allows local development without a persistent cookie secret", () => {
    assert.doesNotThrow(() => assertAdminPinCookieSecretConfigured({ NODE_ENV: "development" }));
    assert.doesNotThrow(() => assertAdminPinCookieSecretConfigured({}));
  });

  it("allows Next production builds to collect page data before runtime env injection", () => {
    assert.doesNotThrow(() =>
      assertAdminPinCookieSecretConfigured({
        NODE_ENV: "production",
        NEXT_PHASE: "phase-production-build",
      }),
    );
  });

  it("sets admin PIN cookies with strict same-site semantics", () => {
    const route = readFileSync("src/app/api/admin/verify-pin/route.ts", "utf8");

    assert.match(route, /sameSite: "strict"/);
    assert.doesNotMatch(route, /sameSite: "lax"/);
  });

  it("keeps raw source IPs and Clerk ids out of permanent admin PIN audit metadata", () => {
    const route = readFileSync("src/app/api/admin/verify-pin/route.ts", "utf8");
    const helperStart = route.indexOf("async function logAdminPinAttempt");
    const helper = route.slice(helperStart, route.indexOf("export async function POST", helperStart));

    assert.match(route, /hashIdentifierForTelemetry\(ip\)/);
    assert.match(route, /hashIdentifierForTelemetry\(userId\)/);
    assert.match(helper, /ipHash/);
    assert.match(helper, /clerkUserIdHash/);
    assert.doesNotMatch(helper, /\bip,\s*\n/);
    assert.doesNotMatch(helper, /clerkUserId,\s*\n/);
    assert.doesNotMatch(route, /extra:\s*\{[^}]*\bip,\s*/s);
    assert.match(route, /user: \{ id: user\.id \}/);
  });

  it("binds admin PIN cookies to the active Clerk session", async () => {
    const now = Date.parse("2026-05-29T00:00:00Z");
    const cookie = await createAdminPinSessionCookieValue("user_1", "sess_1", now);

    assert.ok(cookie?.startsWith("v2."));
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", "sess_1", now), true);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", "sess_2", now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_2", "sess_1", now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie, "user_1", null, now), false);
    assert.equal(await verifyAdminPinCookieValue(cookie?.replace(/^v2\./, "v1."), "user_1", "sess_1", now), false);
  });
});
