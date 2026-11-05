import assert from "node:assert/strict";
import test from "node:test";

const { serializeVariantGroups } = await import("../src/lib/variantEditorState.ts");

const option = (label, priceDraft) => ({ label, priceAdjustCents: 0, inStock: true, priceDraft });

test("deleting an option leaves the typed price on the option it belongs to", () => {
  const options = [option("Small", "0"), option("Large", "50")];
  const [group] = serializeVariantGroups([{ name: "Size", options: options.slice(1) }], true);
  assert.deepEqual(group.options, [{ label: "Large", priceAdjustCents: 5000, inStock: true }]);
});

test("an unfinished group before a named one does not shift its prices", () => {
  const groups = [
    { name: "", options: [option("", "999")] },
    { name: "Wood", options: [option("Walnut", "400"), option("Oak", "-5.50")] },
  ];
  assert.deepEqual(serializeVariantGroups(groups, true), [{
    name: "Wood",
    options: [
      { label: "Walnut", priceAdjustCents: 40000, inStock: true },
      { label: "Oak", priceAdjustCents: -550, inStock: true },
    ],
  }]);
});

test("a saved price survives when nothing was typed", () => {
  const [group] = serializeVariantGroups([{
    name: "Size",
    options: [{ label: "Large", priceAdjustCents: 1250, inStock: false }],
  }], false);
  assert.deepEqual(group.options, [{ label: "Large", priceAdjustCents: 1250, inStock: false }]);
});
