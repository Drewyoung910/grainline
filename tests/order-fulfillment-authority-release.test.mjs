import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS,
  ORDER_FULFILLMENT_AUTHORITY_MIGRATION_SHA256,
  verifyOrderFulfillmentAuthorityMigrationBytes,
} from "../scripts/order-fulfillment-authority-catalog.mjs";

const migration = readFileSync(
  "prisma/migrations/20260901130000_prepare_order_fulfillment_authority/migration.sql",
  "utf8",
);

describe("Order fulfillment-authority release", () => {
  it("is byte pinned and exposes exactly three narrow runtime operations", () => {
    const verified = verifyOrderFulfillmentAuthorityMigrationBytes();
    assert.equal(
      verified.migrationSha256,
      ORDER_FULFILLMENT_AUTHORITY_MIGRATION_SHA256,
    );
    assert.equal(ORDER_FULFILLMENT_AUTHORITY_FUNCTIONS.length, 3);
    assert.equal((migration.match(/SECURITY DEFINER/g) ?? []).length, 3);
    assert.equal((migration.match(/SET search_path = pg_catalog/g) ?? []).length, 3);
    assert.equal((migration.match(/GRANT EXECUTE ON FUNCTION/g) ?? []).length, 3);
    assert.equal((migration.match(/TO grainline_app_runtime/g) ?? []).length, 3);
    assert.equal((migration.match(/REVOKE ALL ON FUNCTION/g) ?? []).length, 3);
  });

  it("changes no table grant, policy or RLS posture", () => {
    assert.doesNotMatch(migration, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)\s+ON/i);
    assert.doesNotMatch(migration, /REVOKE\s+.*ON\s+(?:TABLE\s+)?public\."Order"/i);
    assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/i);
    assert.doesNotMatch(migration, /CREATE POLICY|ALTER POLICY|DROP POLICY/i);
  });

  it("derives ownership, transitions, clocks and audit identity in PostgreSQL", () => {
    assert.match(migration, /locked_order\."sellerProfileId" IS DISTINCT FROM source_seller\.id/);
    assert.match(migration, /locked_order\."buyerId" IS DISTINCT FROM locked_actor\.id/);
    assert.equal((migration.match(/FOR SHARE OF actor/g) ?? []).length, 3);
    assert.equal((migration.match(/FOR UPDATE OF source_order/g) ?? []).length, 3);
    assert.match(migration, /transition_at := pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'/);
    assert.match(migration, /'order-fulfillment-audit:' \|\| pg_catalog\.gen_random_uuid\(\)::text/);
    assert.match(migration, /'order-receipt-audit:' \|\| pg_catalog\.gen_random_uuid\(\)::text/);
    assert.match(migration, /'order-seller-note-audit:' \|\| pg_catalog\.gen_random_uuid\(\)::text/);
    assert.doesNotMatch(migration, /JOIN public\."Listing"/);
  });
});
