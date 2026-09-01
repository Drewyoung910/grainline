import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migrationPath =
  "prisma/migrations/20260901050000_prepare_order_public_aggregate_authority/migration.sql";
const migration = readFileSync(migrationPath, "utf8");
const authority = readFileSync("src/lib/orderPublicAggregateAuthority.ts", "utf8");
const state = readFileSync("src/lib/orderPublicAggregateState.ts", "utf8");

function source(path) {
  return readFileSync(path, "utf8");
}

describe("Order public aggregate authority contract", () => {
  it("converts the four public aggregate consumers away from direct Order reads", () => {
    const converted = [
      "src/lib/homepageStats.ts",
      "src/lib/publicSellerStats.ts",
      "src/lib/quality-score.ts",
      "src/lib/site-metrics-snapshot.ts",
    ];
    for (const path of converted) {
      const text = source(path);
      assert.doesNotMatch(
        text,
        /(?:prisma|tx|client)\.order\b|(?:FROM|JOIN)\s+(?:public\.)?["`]Order["`]/iu,
        path,
      );
      assert.match(text, /orderPublicAggregateAuthority|getPublic/u, path);
    }
  });

  it("keeps public outputs aggregate-only and closes every function to PUBLIC", () => {
    assert.equal((migration.match(/^SECURITY DEFINER$/gmu) ?? []).length, 4);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gmu) ?? []).length, 4);
    assert.equal((migration.match(/FROM PUBLIC;/gmu) ?? []).length, 4);
    assert.equal((migration.match(/TO grainline_app_runtime;/gmu) ?? []).length, 4);
    assert.doesNotMatch(
      migration,
      /RETURNS (?:SETOF )?public\."Order"|"buyerId"\s+(?:text|AS)|"shipTo|stripeChargeId"\s+(?:text|AS)/iu,
    );
    assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/iu);
    assert.doesNotMatch(migration, /(?:INSERT|UPDATE|DELETE)\s+(?:INTO|public\.)/iu);
  });

  it("derives visibility, payment validity and bounded batch authority in PostgreSQL", () => {
    assert.match(migration, /pg_catalog\.cardinality\(p_listing_ids\) NOT BETWEEN 1 AND 200/u);
    assert.match(migration, /pg_catalog\.count\(DISTINCT requested\.id\)/u);
    assert.match(migration, /listing\.status = 'ACTIVE'::public\."ListingStatus"/u);
    assert.match(migration, /listing\."isPrivate" = false/u);
    assert.match(migration, /seller\."vacationMode" = false/u);
    assert.match(migration, /seller_user\.banned = false/u);
    assert.match(migration, /seller_user\."deletedAt" IS NULL/u);
    assert.match(migration, /source_order\."paidAt" IS NOT NULL/u);
    assert.match(migration, /source_order\."sellerRefundId" IS NULL/u);
    assert.match(migration, /source_order\."paymentRefundBlocked" = false/u);
    assert.match(authority, /normalized\.length > 200/u);
    assert.match(state, /counts\.has\(row\.listing_id\)/u);
  });
});
