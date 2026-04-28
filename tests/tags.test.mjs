import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { normalizeTag, normalizeTags } = await import("../src/lib/tags.ts");

describe("tag normalization", () => {
  it("keeps readable accented Latin tags", () => {
    assert.equal(normalizeTag("Café Crème"), "cafe-creme");
  });

  it("does not collapse non-Latin tags to empty strings", () => {
    assert.equal(normalizeTag("家具"), "家具");
    assert.equal(normalizeTag("木工 机"), "木工-机");
  });

  it("strips bidirectional controls and caps tag length", () => {
    assert.equal(normalizeTag("refund\u202Egpj.exe"), "refundgpj-exe");
    assert.equal(normalizeTag("a".repeat(40)), "a".repeat(24));
  });

  it("dedupes tags after normalization and respects the max", () => {
    assert.deepEqual(normalizeTags(["Café", "cafe", "家具", "Oak"], 3), ["cafe", "家具", "oak"]);
  });
});
