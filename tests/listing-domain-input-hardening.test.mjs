import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const [migration, detailAccess, ownerAccess] = await Promise.all([
  readFile(new URL("prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql", root), "utf8"),
  readFile(new URL("src/lib/listingDetailAccess.ts", root), "utf8"),
  readFile(new URL("src/lib/listingOwnerAccess.ts", root), "utf8"),
]);

test("malformed listing read ids return an absent row instead of throwing", () => {
  assert.match(
    detailAccess,
    /export async function listingActorDetailSource[\s\S]*if \(!validId\(listingId\)\) \{\s*return null;/u,
  );
  assert.match(
    ownerAccess,
    /async function readListingOwnerEditor[\s\S]*if \(!validId\(listingId\)\) \{\s*return null;/u,
  );
});

test("preparation fails closed on legacy transaction-shape drift", () => {
  assert.match(
    migration,
    /pg_catalog\.char_length\(material\.value\) NOT BETWEEN 1 AND 100/u,
  );
  assert.match(
    migration,
    /Listing product-dimension inventory contains % invalid rows/u,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "Listing_product_dimensions_nonnegative_chk"[\s\S]*"productLengthIn" >= 0[\s\S]*"productWidthIn" >= 0[\s\S]*"productHeightIn" >= 0/u,
  );
  assert.match(
    migration,
    /VALIDATE CONSTRAINT "Listing_product_dimensions_nonnegative_chk"/u,
  );
  assert.match(
    migration,
    /Listing transaction inventory contains % invalid rows/u,
  );
  assert.match(
    migration,
    /ADD CONSTRAINT "Listing_shipping_package_nonnegative_chk"[\s\S]*"packagedWeightGrams" >= 0[\s\S]*"packagedLengthCm" >= 0[\s\S]*"packagedWidthCm" >= 0[\s\S]*"packagedHeightCm" >= 0/u,
  );
});

test("owner writers reject forged negative product dimensions", () => {
  assert.match(
    ownerAccess,
    /function validNullableNonnegativeFinite[\s\S]*Number\.isFinite\(value\) && value >= 0/u,
  );
  assert.equal(
    ownerAccess.match(/!validNullableNonnegativeFinite\(input\.productLengthIn\)/gu)?.length,
    2,
  );
  assert.equal(
    migration.match(/p_product_length_in < 0/gu)?.length,
    2,
  );
  assert.equal(
    migration.match(/p_product_width_in < 0/gu)?.length,
    2,
  );
  assert.equal(
    migration.match(/p_product_height_in < 0/gu)?.length,
    2,
  );
});

test("owner writers reject forged negative shipping package values", () => {
  assert.equal(
    ownerAccess.match(/!validNullableNonnegativeFinite\(input\.packagedLengthCm\)/gu)?.length,
    2,
  );
  assert.equal(
    ownerAccess.match(/!validNullableNonnegativeSafeInteger\(input\.packagedWeightGrams\)/gu)?.length,
    2,
  );
  assert.equal(migration.match(/p_packaged_length_cm < 0/gu)?.length, 2);
  assert.equal(migration.match(/p_packaged_weight_grams < 0/gu)?.length, 2);
});

test("an approved edit can leave review while the seller is temporarily not orderable", () => {
  assert.match(
    migration,
    /p_source_status <> 'PENDING_REVIEW'\s+AND p_status IN \('ACTIVE', 'SOLD_OUT'\)\s+AND NOT source_listing\."sellerPubliclyOrderable"/u,
  );
});
