import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  normalizeDisplayNameForLookup,
  sanitizeRichText,
  sanitizeText,
  sanitizeUserName,
  stripBidiControls,
  truncateText,
  truncateTextWithEllipsis,
} = await import("../src/lib/sanitize.ts");
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

  it("keeps the joiners that shape emoji and Persian or Indic text", () => {
    for (const text of [
      "🤷\u200D♀\uFE0F",
      "👨\u200D👩\u200D👧",
      "👩🏽\u200D💻",
      "🏳\uFE0F\u200D🌈",
      "می\u200Cخواهم",
      "क्\u200Dष",
      "क्\u200Cष",
    ]) {
      assert.equal(sanitizeText(text), text);
    }
    // Between Latin letters a joiner only hides characters.
    assert.equal(sanitizeText("ad\u200Dmin a\u200Cb ad\u2060min"), "admin ab admin");
    assert.equal(sanitizeText("🤷\u200Dx"), "🤷x");
  });

  it("empties text made only of blank characters and drops control characters", () => {
    for (const blank of ["\u2800", "\u3164\u3164", "\u115F\u1160", "\uFFA0", " \u2800 "]) {
      assert.equal(sanitizeUserName(blank), "");
    }
    assert.equal(sanitizeUserName("Oak\u2800Works"), "Oak Works");
    // Review RO-01: invisible line breaks, format characters, variation
    // selectors and tag characters on their own are blank too.
    for (const blank of [
      "\u0085", "\u180E", "\u206A\u206F", "\uFE0F\uFE0F", "\uFE00",
      "\u{E0041}\u{E007F}", "\u{E0100}", " \u0085\uFE0F ",
    ]) {
      assert.equal(sanitizeUserName(blank), "", JSON.stringify(blank));
    }
    assert.equal(sanitizeText("ad\u180Emin ad\u206Fmin"), "admin admin");
    assert.equal(sanitizeRichText("line one\u0085line two"), "line one\nline two");
    assert.equal(sanitizeUserName("Oak\u0085Works"), "Oak Works");
    // An emoji keeps its presentation selector and its tag sequence.
    const englandFlag = "🏴\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";
    assert.equal(sanitizeUserName(`Oak ❤\uFE0F ${englandFlag}`), `Oak ❤\uFE0F ${englandFlag}`);
    assert.equal(sanitizeText("a\u0007b\u001Bc\u007Fd\u009Fe"), "abcde");
    assert.equal(sanitizeRichText("line one\nline\ttwo\r\nthree"), "line one\nline\ttwo\r\nthree");
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

  it("uses the user-name sanitizer as the seller display-name lookup key", () => {
    assert.equal(normalizeDisplayNameForLookup("\u0410cm\u0435 Woodworks"), "Acme Woodworks");
    assert.equal(normalizeDisplayNameForLookup("  Maker\u200B   Shop  "), "Maker Shop");
    // Review RO-04: names keep their joiners, but the lookup key drops them so
    // two names that look the same still collide in the duplicate warning.
    assert.equal(sanitizeUserName("ب\u200Dب"), "ب\u200Dب");
    assert.equal(normalizeDisplayNameForLookup("ب\u200Dب"), "بب");
    assert.equal(normalizeDisplayNameForLookup("😀\u200D😀"), "😀😀");
    assert.equal(normalizeDisplayNameForLookup("می\u200Cخواهم"), "میخواهم");
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

  it("keeps downstream text-normalization helpers on the canonical sanitizer", () => {
    for (const path of [
      "src/lib/aiReviewSafety.ts",
      "src/lib/notificationPayload.ts",
      "src/lib/profanity.ts",
      "src/lib/tags.ts",
    ]) {
      const text = readFileSync(path, "utf8");
      assert.match(text, /normalizeUserText/);
      assert.doesNotMatch(text, /const BIDI_CONTROL_CHARS/);
      assert.doesNotMatch(text, /const CYRILLIC_CONFUSABLES/);
    }
  });
});
