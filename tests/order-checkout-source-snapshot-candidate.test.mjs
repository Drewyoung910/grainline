import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const sql = readFileSync(
  "docs/rls-drafts/order-checkout-source-snapshot.sql",
  "utf8",
);
const authority = readFileSync("src/lib/checkoutStockReservationAuthority.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const singleCheckout = readFileSync("src/app/api/cart/checkout/single/route.ts", "utf8");
const cartCheckout = readFileSync("src/app/api/cart/checkout-seller/route.ts", "utf8");

describe("Order checkout source snapshot candidate", () => {
  it("adds one nullable bounded object without rewriting predecessor rows", () => {
    assert.match(sql, /ADD COLUMN "sourceSnapshot" jsonb/);
    assert.match(sql, /"sourceSnapshot" IS NULL/);
    assert.match(sql, /jsonb_typeof\("sourceSnapshot"\) = 'object'/);
    assert.match(sql, /pg_column_size\("sourceSnapshot"\) <= 4194304/);
    assert.doesNotMatch(sql, /UPDATE public\."CheckoutStockReservation"[\s\S]*WHERE "sourceSnapshot" IS NULL/);
    assert.match(
      schema,
      /model CheckoutStockReservation \{[\s\S]*sourceSnapshot\s+Json\?/,
    );
  });

  it("persists cart source only after the locked consistent predecessor accepts it", () => {
    const predecessor = sql.indexOf("grainline_checkout_reservation_create_cart_consistent(");
    const persistence = sql.indexOf('SET "sourceSnapshot" = p_expected_source', predecessor);
    assert.ok(predecessor >= 0 && persistence > predecessor);
    assert.match(sql, /reservation\."sellerId" = p_seller_profile_id/);
    assert.match(sql, /reservation\.status = 'RESERVED'/);
    assert.match(sql, /updated_count <> 1[\s\S]*serialization_failure/);
    assert.match(sql, /grainline_checkout_reservation_listing_snapshot_witness/);
    assert.match(sql, /source_item->'listing' IS DISTINCT FROM/);
  });

  it("creates a source-only made-to-order lifecycle row without inventing stock", () => {
    const single = sql.slice(sql.indexOf("grainline_checkout_reservation_create_single_snapshot"));
    assert.match(single, /grainline_checkout_reservation_create_single_consistent/);
    assert.match(single, /source_listing_type <> 'MADE_TO_ORDER'/);
    assert.match(single, /source_reserved_items := '\[\]'::jsonb/);
    assert.match(single, /INSERT INTO public\."CheckoutStockReservation"/);
    assert.doesNotMatch(single, /UPDATE public\."Listing"/);
  });

  it("keeps both successors fixed, search-path pinned and runtime-only", () => {
    assert.equal((sql.match(/SECURITY DEFINER/g) ?? []).length, 3);
    assert.equal((sql.match(/SET search_path = pg_catalog/g) ?? []).length, 3);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 3);
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 2);
    assert.doesNotMatch(sql, /EXECUTE\s+format|\bEXECUTE\s+p_/i);
  });

  it("routes every new checkout through the snapshot successors", () => {
    assert.match(
      authority,
      /createSnapshotCartCheckoutStockReservation[\s\S]*grainline_checkout_reservation_create_cart_snapshot/,
    );
    assert.match(
      authority,
      /createSnapshotSingleCheckoutStockReservation[\s\S]*grainline_checkout_reservation_create_single_snapshot/,
    );
    assert.match(cartCheckout, /createSnapshotCartCheckoutStockReservation\(\{/);
    assert.match(singleCheckout, /createSnapshotSingleCheckoutStockReservation\(\{/);
    assert.match(cartCheckout, /cartCheckoutReservationSnapshotWitness\(/);
    assert.match(singleCheckout, /singleCheckoutReservationSnapshotWitness\(/);
    assert.match(singleCheckout, /if \(!reservation\)[\s\S]*Snapshot single reservation returned no reservation/);
    assert.match(singleCheckout, /checkoutReservationId = reservation\.id/);
    assert.doesNotMatch(singleCheckout, /listing\.listingType === "IN_STOCK"\)\) \{/);
  });
});
