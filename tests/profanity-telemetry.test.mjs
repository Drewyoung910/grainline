import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("profanity moderation telemetry", () => {
  it("uses bounded Sentry telemetry instead of raw console match logs", () => {
    const paths = [
      "src/app/messages/[id]/page.tsx",
      "src/app/dashboard/blog/new/page.tsx",
      "src/app/dashboard/blog/[id]/edit/page.tsx",
      "src/app/api/seller/broadcast/route.ts",
      "src/app/api/commission/route.ts",
      "src/app/api/blog/[slug]/comments/route.ts",
      "src/app/api/reviews/route.ts",
      "src/app/api/reviews/[id]/reply/route.ts",
    ];

    for (const path of paths) {
      const text = source(path);
      assert.match(text, /captureProfanityFlag/);
      assert.doesNotMatch(text, /\[PROFANITY\]/);
      assert.doesNotMatch(text, /matches\.join/);
    }
  });

  it("does not send raw matched words or submitted text to Sentry", () => {
    const helper = source("src/lib/profanityTelemetry.ts");

    assert.match(helper, /Sentry\.captureMessage/);
    assert.match(helper, /matchCount/);
    assert.doesNotMatch(helper, /\bmatches\b/);
    assert.doesNotMatch(helper, /\btext\b/);
  });
});
