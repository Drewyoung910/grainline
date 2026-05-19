import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sanitizeRichText, sanitizeText, sanitizeUserName, stripBidiControls, truncateText, truncateTextWithEllipsis } = await import("../src/lib/sanitize.ts");
const { containsProfanity } = await import("../src/lib/profanity.ts");

describe("unicode sanitization", () => {
  it("strips bidirectional control characters from user-visible text", () => {
    assert.equal(stripBidiControls("refund\u202Egpj.exe"), "refundgpj.exe");
    assert.equal(sanitizeText("Maker\u2066 Name"), "Maker Name");
    assert.equal(sanitizeText("pay\u061Cment"), "payment");
  });

  it("strips zero-width and null characters from canonical user text", () => {
    assert.equal(sanitizeText("f\u200bu\u200dc\uFEFFk\u0000"), "fuck");
  });

  it("strips nested or malformed HTML from plain text", () => {
    assert.equal(sanitizeText("<<script>alert(1)</script>Chair"), "Chair");
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

  it("supports bounded rich-text persistence without script content", () => {
    const cleaned = sanitizeRichText(`${"a".repeat(505)}<script>alert(1)</script>`);
    assert.equal(truncateText(cleaned, 500), "a".repeat(500));
  });

  it("strips active rich-text markup instead of preserving future HTML sinks", () => {
    const cleaned = sanitizeRichText(
      '<svg onload="alert(1)">bad</svg><object data="x"></object><style>body{}</style><b>Chair</b>',
    );

    assert.equal(cleaned, "badChair");
    assert.doesNotMatch(cleaned, /svg|object|style|onload|<|>/i);
  });

  it("decodes entity-obfuscated protocols before protocol stripping", () => {
    assert.equal(sanitizeRichText("j&#x61;vascript:alert(1)"), "alert(1)");
  });

  it("strips whitespace-obfuscated and file protocol text", () => {
    assert.equal(sanitizeText("java\tscript:alert(1) file:///etc/passwd"), "alert(1) ///etc/passwd");
    assert.equal(sanitizeRichText("d a t a:text/html vb script:msgbox(1)"), "text/html msgbox(1)");
  });

  it("normalizes Cyrillic confusables before profanity matching", () => {
    const result = containsProfanity("handmade \u0441\u043Eck ornament");
    assert.equal(result.flagged, true);
    assert.deepEqual(result.matches, ["cock"]);
  });

  it("normalizes zero-width profanity before matching", () => {
    const result = containsProfanity("f\u200bu\u200bc\u200bk");
    assert.equal(result.flagged, true);
    assert.deepEqual(result.matches, ["fuck"]);
  });
});
