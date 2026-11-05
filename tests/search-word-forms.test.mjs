import assert from "node:assert/strict";
import test from "node:test";

import { searchWordForms } from "../src/lib/searchWordForms.ts";

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
    ["stoves", "stove"],
  ]) {
    assert.ok(searchWordForms(plural).includes(singular), `${plural} should include ${singular}`);
    assert.ok(searchWordForms(plural).includes(plural), `${plural} keeps the typed word`);
  }
});

test("a singular word ending in f also looks for its -ves plural", () => {
  assert.ok(searchWordForms("shelf").includes("shelves"));
  assert.ok(searchWordForms("knife").includes("knives"));
});

test("words that are not plurals are left alone", () => {
  for (const word of ["glass", "this", "plus", "table", "gas", "oak"]) {
    assert.deepEqual(searchWordForms(word), [word]);
  }
});

test("forms are lowercase", () => {
  assert.deepEqual(searchWordForms("Tables"), ["tables", "table"]);
});
