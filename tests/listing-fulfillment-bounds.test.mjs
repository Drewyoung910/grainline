import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MAX_LISTING_FULFILLMENT_DAYS,
  MIN_LISTING_FULFILLMENT_DAYS,
  listingProcessingWindowError,
  parseListingFulfillmentDays,
} from "../src/lib/listingFulfillmentDays.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

test("listing fulfillment day parsing accepts only blank or bounded whole days", () => {
  assert.equal(MIN_LISTING_FULFILLMENT_DAYS, 1);
  assert.equal(MAX_LISTING_FULFILLMENT_DAYS, 365);
  assert.deepEqual(parseListingFulfillmentDays("", "Window"), { ok: true, value: null });
  assert.deepEqual(parseListingFulfillmentDays("1", "Window"), { ok: true, value: 1 });
  assert.deepEqual(parseListingFulfillmentDays("365", "Window"), { ok: true, value: 365 });
  for (const value of ["0", "366", "2.5", "3 days", "Infinity", 9_007_199_254_740_992]) {
    assert.equal(parseListingFulfillmentDays(value, "Window").ok, false, String(value));
  }
});

test("processing windows reject an inverted range", () => {
  assert.equal(listingProcessingWindowError(null, null), null);
  assert.equal(listingProcessingWindowError(1, 365), null);
  assert.match(listingProcessingWindowError(8, 7), /minimum cannot exceed/u);
});

test("every listing mutation uses the shared server bounds and the form exposes the same maximum", () => {
  for (const path of [
    "src/app/dashboard/listings/new/page.tsx",
    "src/app/dashboard/listings/custom/page.tsx",
    "src/app/dashboard/listings/[id]/edit/page.tsx",
  ]) {
    const page = source(path);
    assert.match(page, /parseListingFulfillmentDays/iu, path);
    assert.match(page, /listingProcessingWindowError/iu, path);
  }

  const fields = source("src/components/ListingTypeFields.tsx");
  assert.equal((fields.match(/max=\{MAX_LISTING_FULFILLMENT_DAYS\}/gu) ?? []).length, 3);
});

test("database rejects new out-of-range ships-within values", () => {
  const migration = source(
    "prisma/migrations/20260930030000_bound_listing_fulfillment_days/migration.sql",
  );
  assert.match(migration, /ADD CONSTRAINT "Listing_ships_within_days_valid_chk"/u);
  assert.match(migration, /"shipsWithinDays" >= 1 AND "shipsWithinDays" <= 365/u);
  assert.match(migration, /NOT VALID/u);
  assert.match(migration, /VALIDATE CONSTRAINT "Listing_ships_within_days_valid_chk"/u);
});
