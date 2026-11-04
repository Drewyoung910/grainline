import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

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

test("the preparation inventory refuses empty or oversized legacy materials", () => {
  const migration = readFileSync(
    "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
    "utf8",
  );
  assert.match(migration, /invalid_material_rows/u);
  assert.match(migration, /char_length\(material\.value\) < 1/u);
  assert.match(migration, /char_length\(material\.value\) > 100/u);
});
