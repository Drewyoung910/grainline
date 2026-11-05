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
        approved: false,
        flags: ["x".repeat(200), 7, "ok"],
        confidence: 7,
        reason: `  ${"Needs review ".repeat(80)}  `,
        altTexts: ["<script>alert(1)</script> walnut table"],
      },
      2,
    );

    assert.equal(result.approved, false);
    assert.equal(result.flags.length, 2);
    assert.equal(result.flags[0].length, 80);
    assert.equal(result.confidence, 1);
    assert.ok(result.reason.length <= 500);
    assert.deepEqual(result.altTexts, [
      "walnut table",
      "Handmade woodworking product photo",
    ]);
  });

  it("fails closed for semantically contradictory moderation decisions", () => {
    const result = normalizeAIReviewResult(
      {
        approved: true,
        flags: ["counterfeit"],
        confidence: 0.95,
        reason: "Counterfeit branded item",
        altTexts: [],
      },
      0,
    );

    assert.equal(result.approved, false);
    assert.deepEqual(result.flags, ["semantic-ai-review-mismatch", "counterfeit"]);
    assert.equal(result.confidence, 0.95);
  });

  it("adds a hold flag when the model rejects without a usable flag", () => {
    const result = normalizeAIReviewResult(
      {
        approved: false,
        flags: [],
        confidence: 0.91,
        reason: "Rejected",
        altTexts: [],
      },
      0,
    );

    assert.equal(result.approved, false);
    assert.deepEqual(result.flags, ["ai-review-held"]);
  });

  it("passes only when every photo has a product verdict", () => {
    const approved = (photoVerdicts, photos) => normalizeAIReviewResult(
      { approved: true, flags: [], confidence: 0.9, reason: "Looks good", altTexts: [], photoVerdicts },
      photos,
    );

    const passed = approved(["product", "product"], 2);
    assert.equal(passed.approved, true);
    assert.deepEqual(passed.flags, []);
    assert.equal(passed.reason, "Looks good");

    assert.equal(approved([], 0).approved, true);
    assert.equal(approved(undefined, 0).approved, true);

    for (const [verdicts, photos, flag] of [
      [["product", "not-product"], 2, "non-product-photo"],
      [["product"], 2, "photo-not-reviewed"],
      [undefined, 2, "photo-not-reviewed"],
      [["product", "maybe"], 2, "photo-not-reviewed"],
      [["product", "product", "product"], 2, "photo-not-reviewed"],
    ]) {
      const held = approved(verdicts, photos);
      assert.equal(held.approved, false);
      assert.deepEqual(held.flags, [flag]);
      assert.match(held.reason, /photos/);
    }
  });

  it("keeps the model's own reason when it rejected the listing itself", () => {
    const held = normalizeAIReviewResult(
      { approved: false, flags: ["counterfeit"], confidence: 0.9, reason: "Looks counterfeit", altTexts: [], photoVerdicts: ["not-product"] },
      1,
    );
    assert.deepEqual(held.flags, ["counterfeit", "non-product-photo"]);
    assert.equal(held.reason, "Looks counterfeit");
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

  it("uses the canonical AI alt-text sanitizer for bulk-review alt text", () => {
    const result = normalizeAIReviewResult(
      {
        approved: true,
        flags: [],
        confidence: 0.9,
        reason: "ok",
        altTexts: ["Сedar table\u202E with <svg onload=alert(1)>"],
      },
      1,
    );

    assert.deepEqual(result.altTexts, ["Cedar table with"]);
  });
});
