import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { containsProfanity, containsSlur, MILD_WORDS, SLUR_WORDS } = await import("../src/lib/profanity.ts");

// Fixtures are built from the lists at run time so no slur appears in this file.
describe("profanity tiers", () => {
  it("every slur-tier word is caught, with capitals, a plural and an invisible soft hyphen", () => {
    assert.ok(SLUR_WORDS.length > 0);
    for (const word of SLUR_WORDS) {
      const spot = `Handmade bench. ${word} and more.`;
      assert.equal(containsSlur(spot), true);
      assert.equal(containsProfanity(spot).flagged, true);
      assert.equal(containsSlur(word.toUpperCase()), true);
      assert.equal(containsSlur(`${word.slice(0, 2)}­${word.slice(2)}`), true);
      if (!word.includes(" ")) assert.equal(containsSlur(`${word}s`), true);
    }
  });

  it("mild words are logged but never count as slurs", () => {
    for (const word of MILD_WORDS) {
      assert.equal(containsProfanity(word).flagged, true);
      assert.equal(containsSlur(word), false);
    }
  });

  it("does not fire on ordinary woodworking text", () => {
    const benign = [
      "Spice rack that holds twenty spices, in hard maple with a spade bit detail.",
      "Flame retardant finish and a slow drying retarder.",
      "Monkey wrench rack, dovetail joints, class of oak, passionate maker.",
    ].join(" ");
    assert.equal(containsSlur(benign), false);
    assert.equal(containsProfanity(benign).flagged, false);
  });

  it("empty input is clean", () => {
    assert.equal(containsSlur(""), false);
    assert.equal(containsSlur(null), false);
    assert.equal(containsSlur(undefined), false);
  });
});
