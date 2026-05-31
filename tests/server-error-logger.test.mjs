import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  sanitizeServerErrorMessage,
  sanitizeServerErrorTags,
  sanitizeServerErrorExtra,
} = await import("../src/lib/serverErrorLogger.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("server error logger", () => {
  it("sanitizes high-risk values before telemetry context", () => {
    const message = sanitizeServerErrorMessage(
      new Error("Failed for maker@example.com at https://example.com/reset?token=sk_test_123456789012"),
    );

    assert.match(message, /\[email\]/);
    assert.match(message, /\[url\]/);
    assert.doesNotMatch(message, /maker@example\.com/);
    assert.doesNotMatch(message, /https:\/\/example\.com/);

    assert.deepEqual(
      sanitizeServerErrorTags({
        route: "/dashboard/seller",
        recipient: "maker@example.com",
      }),
      {
        route: "/dashboard/seller",
        recipient: "[email]",
      },
    );
    assert.deepEqual(
      sanitizeServerErrorExtra({
        url: "https://example.com/private?x=1",
        count: 2,
        ok: false,
      }),
      {
        url: "[url]",
        count: 2,
        ok: false,
      },
    );
  });

  it("routes selected server action failures through the shared helper", () => {
    const files = [
      "src/app/admin/actions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/dashboard/onboarding/actions.ts",
      "src/app/dashboard/page.tsx",
      "src/app/dashboard/seller/page.tsx",
    ];

    for (const path of files) {
      const text = source(path);
      assert.match(text, /logServerError\(/, `${path} should use shared server error logging`);
    }

    assert.doesNotMatch(source("src/app/admin/actions.ts"), /console\.error\("markReviewed failed:/);
    assert.doesNotMatch(source("src/app/admin/actions.ts"), /console\.error\("appendNote failed:/);
    assert.doesNotMatch(source("src/app/admin/support/actions.ts"), /console\.error\("setSupportRequestStatus failed:/);
    assert.doesNotMatch(source("src/app/dashboard/onboarding/actions.ts"), /console\.error\("\[onboarding action\] error:/);
    assert.doesNotMatch(source("src/app/dashboard/page.tsx"), /console\.error\("Archive listing failed:/);
    assert.doesNotMatch(source("src/app/dashboard/seller/page.tsx"), /console\.error\("\[stripe-connect\] Failed to refresh seller account status:/);

    assert.match(source("src/lib/serverErrorLogger.ts"), /sanitizeEmailOutboxError\(error\.stack\)/);
  });
});
