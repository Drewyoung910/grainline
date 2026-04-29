import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { assertAdminPinCookieSecretConfigured } = await import("../src/lib/adminPin.ts");

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
});
