import assert from "node:assert/strict";
import test from "node:test";

const { fieldsWithSlur } = await import("../scripts/rescan-slur-text.mjs");
const { MILD_WORDS, SLUR_WORDS } = await import("../src/lib/profanity.ts");

test("names the fields with a slur-tier word and never returns the text", () => {
  const word = SLUR_WORDS[0];
  assert.deepEqual(
    fieldsWithSlur({
      id: word,
      title: "Walnut bench",
      description: `Lovely. ${word}.`,
      tags: ["oak", word],
      metaDescription: null,
      bio: MILD_WORDS[0],
    }),
    ["description", "tags"],
  );
});
