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

test("a price typed with a dollar sign or thousands comma keeps its value", () => {
  const [group] = serializeVariantGroups([{
    name: "Wood",
    options: [option("Walnut", "1,250.00"), option("Cherry", "$50"), option("Pine", "-$5.50")],
  }], true);
  assert.deepEqual(group.options.map((o) => o.priceAdjustCents), [125000, 5000, -550]);
});

test("a price the parser cannot read is flagged instead of becoming zero", async () => {
  const { isVariantPriceDraftInvalid } = await import("../src/lib/variantEditorState.ts");
  for (const draft of ["12.345", "50 dollars", "12,50", "$-5"]) {
    assert.equal(isVariantPriceDraftInvalid(option("Oak", draft)), true, draft);
  }
  for (const draft of ["", "50", "-5.50", "1,250.00", ".5"]) {
    assert.equal(isVariantPriceDraftInvalid(option("Oak", draft)), false, draft);
  }
});

test("the browser price check compiles under the v flag and agrees with the parser", async () => {
  const { VARIANT_PRICE_INPUT_PATTERN, isVariantPriceDraftInvalid } = await import("../src/lib/variantEditorState.ts");
  const browserCheck = new RegExp(`^(?:${VARIANT_PRICE_INPUT_PATTERN})$`, "v");
  for (const draft of ["50", "+50", "-5.50", "$50", "-$50", "1,250.00", ".5", "12.", "12.345", "12,50", "1,2345", "+", "$", "$-5", "50 dollars"]) {
    assert.equal(browserCheck.test(draft), !isVariantPriceDraftInvalid(option("Oak", draft)), draft);
  }
});
