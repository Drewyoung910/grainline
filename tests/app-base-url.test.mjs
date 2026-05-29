import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { resolveAppBaseUrl } = await import("../src/lib/appBaseUrl.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("app base URL resolution", () => {
  it("normalizes configured app URLs and refuses missing production URLs", () => {
    assert.equal(
      resolveAppBaseUrl({ NEXT_PUBLIC_APP_URL: " https://preview.example.test/ " }),
      "https://preview.example.test",
    );
    assert.throws(
      () => resolveAppBaseUrl({ VERCEL_ENV: "production" }),
      /NEXT_PUBLIC_APP_URL env var is required in production/,
    );
    assert.equal(resolveAppBaseUrl({ NODE_ENV: "test" }), "http://localhost:3000");
  });

  it("keeps absolute external-link builders off hard-coded production fallbacks", () => {
    const files = [
      "src/lib/internalReturnUrl.ts",
      "src/lib/unsubscribeToken.ts",
      "src/app/api/stripe/connect/create/route.ts",
      "src/app/api/admin/email/route.ts",
      "src/app/api/cases/[id]/messages/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
    ];

    for (const file of files) {
      const text = source(file);
      assert.doesNotMatch(
        text,
        /NEXT_PUBLIC_APP_URL\s*\|\|\s*"https:\/\/thegrainline\.com"/,
        `${file} must not silently fall back to the production origin`,
      );
    }
  });
});
