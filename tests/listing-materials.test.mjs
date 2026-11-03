import assert from "node:assert/strict";
import test from "node:test";

const {
  MAX_LISTING_MATERIALS,
  MAX_LISTING_MATERIAL_CODE_POINTS,
  parseListingMaterials,
} = await import("../src/lib/listingMaterials.ts");

test("listing materials are sanitized, trimmed, and bounded by count", () => {
  const parsed = parseListingMaterials(" walnut,  maple , brass ");
  assert.deepEqual(parsed, { ok: true, value: ["walnut", "maple", "brass"] });

  const tooMany = Array.from({ length: MAX_LISTING_MATERIALS + 1 }, (_, index) => `m${index}`).join(",");
  assert.deepEqual(parseListingMaterials(tooMany), {
    ok: false,
    error: `Add no more than ${MAX_LISTING_MATERIALS} materials.`,
  });
});

test("listing material length uses Unicode code points and rejects oversized entries", () => {
  const atLimit = "🪵".repeat(MAX_LISTING_MATERIAL_CODE_POINTS);
  assert.deepEqual(parseListingMaterials(atLimit), { ok: true, value: [atLimit] });

  const overLimit = `${atLimit}🪵`;
  assert.deepEqual(parseListingMaterials(overLimit), {
    ok: false,
    error: `Each material must be ${MAX_LISTING_MATERIAL_CODE_POINTS} characters or fewer.`,
  });
});

test("listing materials never persist live markup", () => {
  const parsed = parseListingMaterials("<b>walnut</b>, maple");
  assert.deepEqual(parsed, { ok: true, value: ["walnut", "maple"] });
});
