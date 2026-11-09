import assert from "node:assert/strict";
import test from "node:test";

const { publicReviewerName } = await import("../src/lib/reviewAuthorPrivacy.ts");

test("shows a first name and last initial", () => {
  assert.equal(publicReviewerName("Bea Buyer"), "Bea B.");
  assert.equal(publicReviewerName("Mary Jane Smith"), "Mary S.");
  assert.equal(publicReviewerName("  Zoë   O'Neil "), "Zoë O.");
  assert.equal(publicReviewerName("Madonna"), "Madonna");
});

test("reads the initial as a whole character", () => {
  assert.equal(publicReviewerName("Sam 😀rtist"), "Sam 😀.");
});

test("never publishes an email-looking name or a blank", () => {
  assert.equal(publicReviewerName("bea@example.com"), "Buyer");
  assert.equal(publicReviewerName("   "), "Buyer");
  assert.equal(publicReviewerName(null), "Buyer");
});
