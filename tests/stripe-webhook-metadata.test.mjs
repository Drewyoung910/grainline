import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { parseSelectedVariantsMetadata } = await import("../src/lib/stripeWebhookMetadata.ts");

describe("Stripe webhook metadata parsing", () => {
  it("normalizes selected variant snapshots from metadata", () => {
    const result = parseSelectedVariantsMetadata(JSON.stringify([
      { groupName: "Wood", optionLabel: "Walnut", priceAdjustCents: 250.4 },
    ]));

    assert.deepEqual(result, {
      ok: true,
      selectedVariants: [
        { groupName: "Wood", optionLabel: "Walnut", priceAdjustCents: 250 },
      ],
    });
  });

  it("returns structured failures instead of swallowing malformed metadata", () => {
    assert.deepEqual(parseSelectedVariantsMetadata("{nope"), {
      ok: false,
      error: "invalid_json",
      metadataLength: 5,
    });
    assert.deepEqual(parseSelectedVariantsMetadata("{}"), {
      ok: false,
      error: "not_array",
      metadataLength: 2,
    });
    const invalidShape = JSON.stringify([{ groupName: "Size" }]);
    assert.deepEqual(parseSelectedVariantsMetadata(invalidShape), {
      ok: false,
      error: "invalid_shape",
      metadataLength: invalidShape.length,
    });
  });

  it("treats absent or empty metadata as no selected variants", () => {
    assert.deepEqual(parseSelectedVariantsMetadata(undefined), {
      ok: true,
      selectedVariants: undefined,
    });
    assert.deepEqual(parseSelectedVariantsMetadata("[]"), {
      ok: true,
      selectedVariants: undefined,
    });
  });
});
