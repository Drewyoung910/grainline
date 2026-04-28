import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { sanitizeText, sanitizeUserName, stripBidiControls } = await import("../src/lib/sanitize.ts");
const { containsProfanity } = await import("../src/lib/profanity.ts");

describe("unicode sanitization", () => {
  it("strips bidirectional control characters from user-visible text", () => {
    assert.equal(stripBidiControls("refund\u202Egpj.exe"), "refundgpj.exe");
    assert.equal(sanitizeText("Maker\u2066 Name"), "Maker Name");
  });

  it("normalizes and caps user names at the database boundary", () => {
    assert.equal(sanitizeUserName("Ａlice   \u202E Woodworker", 12), "Alice Woodwo");
  });

  it("normalizes Cyrillic confusables before profanity matching", () => {
    const result = containsProfanity("handmade \u0441\u043Eck ornament");
    assert.equal(result.flagged, true);
    assert.deepEqual(result.matches, ["cock"]);
  });
});
