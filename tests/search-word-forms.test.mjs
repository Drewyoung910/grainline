import assert from "node:assert/strict";
import test from "node:test";

import { listingSearchWordConditions, searchWordForms } from "../src/lib/searchWordForms.ts";

test("plural searches also look for the singular word", () => {
  for (const [plural, singular] of [
    ["tables", "table"],
    ["stools", "stool"],
    ["chairs", "chair"],
    ["boards", "board"],
    ["boxes", "box"],
    ["benches", "bench"],
    ["dishes", "dish"],
    ["shelves", "shelf"],
    ["knives", "knife"],
    ["trophies", "trophy"],
    ["signs", "sign"],
    ["stoves", "stove"],
  ]) {
    assert.ok(searchWordForms(plural).includes(singular), `${plural} should include ${singular}`);
    assert.ok(searchWordForms(plural).includes(plural), `${plural} keeps the typed word`);
  }
});

test("no derived form is shorter than 3 letters", () => {
  for (const word of ["ties", "lies", "pies", "dies", "hats", "lens", "signs", "tables"]) {
    for (const form of searchWordForms(word)) {
      assert.ok(form.length >= 3, `${word} produced ${form}`);
    }
  }
  assert.ok(!searchWordForms("ties").includes("ty"));
  assert.ok(!searchWordForms("lies").includes("ly"));
});

test("singular words do not grow a -ves plural", () => {
  assert.deepEqual(searchWordForms("safe"), ["safe"]);
  assert.deepEqual(searchWordForms("shelf"), ["shelf"]);
});

test("derived forms match titles and tags, but descriptions only match the typed word", () => {
  const conditions = listingSearchWordConditions(["signs", "hats"]);
  const descriptions = conditions.flatMap((c) => (c.description ? [c.description.contains] : []));
  const titles = conditions.flatMap((c) => (c.title ? [c.title.contains] : []));
  const tags = conditions.flatMap((c) => (c.tags ? [c.tags.has] : []));
  assert.deepEqual(descriptions, ["signs", "hats"]);
  assert.deepEqual(titles, ["signs", "sign", "hats", "hat"]);
  assert.deepEqual(tags, ["signs", "sign", "hats", "hat"]);
});

test("words that are not plurals are left alone", () => {
  for (const word of ["glass", "this", "plus", "table", "gas", "oak", "safe"]) {
    assert.deepEqual(searchWordForms(word), [word]);
  }
});

test("forms are lowercase", () => {
  assert.deepEqual(searchWordForms("Tables"), ["tables", "table"]);
});
