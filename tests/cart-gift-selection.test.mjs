import assert from "node:assert/strict";
import test from "node:test";

import { effectiveCartGiftSelection } from "../src/lib/cartGiftSelection.ts";

test("a seller disabling gift wrapping clears only the stale wrapping request", () => {
  assert.deepEqual(
    effectiveCartGiftSelection(
      { giftNote: "Happy birthday", giftWrapping: true },
      false,
    ),
    { giftNote: "Happy birthday", giftWrapping: false },
  );
});

test("an available gift-wrap choice remains selected", () => {
  assert.deepEqual(
    effectiveCartGiftSelection(
      { giftNote: "Happy birthday", giftWrapping: true },
      true,
    ),
    { giftNote: "Happy birthday", giftWrapping: true },
  );
});

test("an absent per-seller gift choice has stable defaults", () => {
  assert.deepEqual(effectiveCartGiftSelection(undefined, true), {
    giftNote: "",
    giftWrapping: false,
  });
});
