import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { hasSoldOutRequiredOption, isListingVariantSelectionComplete } = await import(
  "../src/lib/listingVariantSelection.ts"
);

const groups = [
  {
    id: "material",
    options: [
      { id: "oak", inStock: true },
      { id: "walnut", inStock: true },
    ],
  },
  {
    id: "entrance",
    options: [
      { id: "left", inStock: true },
      { id: "right", inStock: false },
    ],
  },
];

describe("listing variant selection gate", () => {
  it("rejects a partial selection even when one option is present", () => {
    assert.equal(isListingVariantSelectionComplete(groups, ["oak"]), false);
  });

  it("requires one in-stock option from every group", () => {
    assert.equal(isListingVariantSelectionComplete(groups, ["oak", "left"]), true);
    assert.equal(isListingVariantSelectionComplete(groups, ["oak", "right"]), false);
    assert.equal(isListingVariantSelectionComplete(groups, ["oak", "oak"]), false);
  });

  it("allows listings without variant groups", () => {
    assert.equal(isListingVariantSelectionComplete([], []), true);
  });
});

describe("sold-out required option", () => {
  it("is true only when every option in some group is out of stock", () => {
    assert.equal(hasSoldOutRequiredOption(groups), false);
    assert.equal(hasSoldOutRequiredOption([]), false);
    assert.equal(
      hasSoldOutRequiredOption([
        ...groups,
        { id: "finish", options: [{ id: "matte", inStock: false }, { id: "gloss", inStock: false }] },
      ]),
      true,
    );
  });
});
