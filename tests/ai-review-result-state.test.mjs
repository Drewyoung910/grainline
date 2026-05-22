import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeAIReviewResult } = await import("../src/lib/aiReviewResultState.ts");

describe("AI review response normalization", () => {
  it("fails closed for malformed provider responses", () => {
    const result = normalizeAIReviewResult("not-json", 2);

    assert.equal(result.approved, false);
    assert.deepEqual(result.flags, ["invalid-ai-response"]);
    assert.equal(result.confidence, 0);
    assert.equal(result.reason, "AI review returned an invalid response");
    assert.deepEqual(result.altTexts, [
      "Handmade woodworking product photo",
      "Handmade woodworking product photo",
    ]);
  });

  it("bounds strings, clamps confidence, and pads missing alt text", () => {
    const result = normalizeAIReviewResult(
      {
        approved: true,
        flags: ["x".repeat(200), 7, "ok"],
        confidence: 7,
        reason: `  ${"Needs review ".repeat(80)}  `,
        altTexts: ["<script>alert(1)</script> walnut table"],
      },
      2,
    );

    assert.equal(result.approved, true);
    assert.equal(result.flags.length, 2);
    assert.equal(result.flags[0].length, 80);
    assert.equal(result.confidence, 1);
    assert.ok(result.reason.length <= 500);
    assert.deepEqual(result.altTexts, [
      "alert(1) walnut table",
      "Handmade woodworking product photo",
    ]);
  });

  it("sanitizes generated bulk-review alt text before persistence", () => {
    const result = normalizeAIReviewResult(
      {
        approved: true,
        flags: [],
        confidence: 0.9,
        reason: "ok",
        altTexts: ["<img src=x onerror=alert(1)> walnut bowl\u202E data:text/html"],
      },
      1,
    );

    assert.deepEqual(result.altTexts, ["walnut bowl text/html"]);
  });
});
