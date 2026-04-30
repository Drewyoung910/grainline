import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sanitizeText, sanitizeUserName, stripBidiControls, truncateText, truncateTextWithEllipsis } = await import("../src/lib/sanitize.ts");
const { containsProfanity } = await import("../src/lib/profanity.ts");

describe("unicode sanitization", () => {
  it("strips bidirectional control characters from user-visible text", () => {
    assert.equal(stripBidiControls("refund\u202Egpj.exe"), "refundgpj.exe");
    assert.equal(sanitizeText("Maker\u2066 Name"), "Maker Name");
  });

  it("strips nested or malformed HTML from plain text", () => {
    assert.equal(sanitizeText("<<script>alert(1)</script>Chair"), "alert(1)Chair");
    assert.equal(sanitizeText("hello <b onclick=alert(1)>world</b>"), "hello world");
  });

  it("removes dangerous protocol text from plain text", () => {
    assert.equal(sanitizeText("javascript:alert(1) data:text/html"), "alert(1) text/html");
  });

  it("normalizes and caps user names at the database boundary", () => {
    assert.equal(sanitizeUserName("Ａlice   \u202E Woodworker", 12), "Alice Woodwo");
  });

  it("does not split surrogate-pair characters while truncating text", () => {
    assert.equal(truncateText("aa🙂bb", 3), "aa🙂");
    assert.equal(truncateTextWithEllipsis("aa🙂bb", 3), "aa🙂…");
  });

  it("normalizes Cyrillic confusables before profanity matching", () => {
    const result = containsProfanity("handmade \u0441\u043Eck ornament");
    assert.equal(result.flagged, true);
    assert.deepEqual(result.matches, ["cock"]);
  });
});
