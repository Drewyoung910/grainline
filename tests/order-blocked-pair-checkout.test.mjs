import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

function migrationSource(candidates, label) {
  const path = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  assert.ok(path, `${label} migration source must be available`);
  return fs.readFileSync(path, "utf8");
}

const migration = migrationSource([
  process.env.ORDER_BLOCKED_PAIR_CHECKOUT_MIGRATION_PATH,
  "prisma/migrations/20260930032000_block_checkout_user_pairs/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-blocked-pair-checkout/migration.sql`
    : null,
], "blocked-pair checkout");
const reservationPredecessor = migrationSource([
  process.env.ORDER_CHECKOUT_SOURCE_SNAPSHOT_MIGRATION_PATH,
  "prisma/migrations/20260905110000_prepare_order_checkout_source_snapshot/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-zero-direct-compatible-suffix/20260905110000_prepare_order_checkout_source_snapshot/migration.sql`
    : null,
], "checkout source-snapshot predecessor");
const paidPredecessor = migrationSource([
  process.env.ORDER_PRIVATE_CUSTOM_PAID_STATE_MIGRATION_PATH,
  "prisma/migrations/20260930031000_mark_paid_private_listing_sold/migration.sql",
  process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/order-private-custom-paid-state/migration.sql`
    : null,
], "paid-checkout predecessor");

function source(path) {
  return fs.readFileSync(path, "utf8");
}

function functionDefinition(sql, name) {
  const create = `CREATE FUNCTION public.${name}(`;
  const replace = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.indexOf(replace) >= 0 ? sql.indexOf(replace) : sql.indexOf(create);
  assert.ok(start >= 0, `${name} definition is missing`);
  const marker = `$${name}$;`;
  const end = sql.indexOf(marker, start);
  assert.ok(end > start, `${name} terminator is missing`);
  return sql.slice(start, end + marker.length).replace(create, replace);
}

describe("blocked-pair checkout boundary", () => {
  it("uses one reciprocal application check on every pre-payment entry and ready-session resume", () => {
    const helper = source("src/lib/checkoutBlockState.ts");
    assert.match(helper, /blockerId: buyerId, blockedId: sellerUserId/u);
    assert.match(helper, /blockerId: sellerUserId, blockedId: buyerId/u);
    assert.match(helper, /CHECKOUT_PAIR_UNAVAILABLE_MESSAGE = "This checkout is unavailable\."/u);

    for (const path of [
      "src/app/api/cart/add/route.ts",
      "src/app/api/cart/update/route.ts",
      "src/app/api/cart/checkout-seller/route.ts",
      "src/app/api/cart/checkout/single/route.ts",
      "src/app/api/cart/checkout/single/resume/route.ts",
      "src/app/api/shipping/quote/route.ts",
    ]) {
      assert.match(source(path), /await checkoutPairIsBlocked\(me\.id,/u, path);
    }

    const cartResume = source("src/app/api/cart/checkout/resume/route.ts");
    assert.match(cartResume, /const blockedUserIds = await getBlockedUserIdsFor\(me\.id\)/u);
    assert.ok(
      cartResume.indexOf('session.payment_status === "paid"') <
        cartResume.indexOf("blockedUserIds.has(seller.userId)"),
      "a later block must not hide a session that is already paid",
    );
    const singleResume = source("src/app/api/cart/checkout/single/resume/route.ts");
    assert.ok(
      singleResume.indexOf("resumed?.completedSessionId") <
        singleResume.indexOf("await checkoutPairIsBlocked(me.id"),
      "a later block must not hide a completed single-listing session",
    );
  });

  it("serializes reservation block checks through the established sorted User locks", () => {
    for (const name of [
      "grainline_checkout_reservation_create_cart_snapshot",
      "grainline_checkout_reservation_create_single_snapshot",
    ]) {
      const predecessor = functionDefinition(reservationPredecessor, name);
      assert.match(predecessor, /grainline_checkout_reservation_create_(?:cart|single)_consistent\(/u);

      const candidate = functionDefinition(migration, name);
      const predecessorCall = candidate.indexOf("_consistent(");
      const blockCheck = candidate.indexOf('FROM public."Block" AS source_block');
      assert.ok(predecessorCall >= 0 && blockCheck > predecessorCall);
      assert.match(candidate, /source_block\."blockerId" = p_buyer_id/u);
      assert.match(candidate, /RAISE EXCEPTION 'Checkout source witness changed'[\s\S]*serialization_failure/u);
    }

    const consistentSource = source(
      "prisma/migrations/20260814053000_prepare_checkout_stock_reservation_source_consistency/migration.sql",
    );
    assert.equal((consistentSource.match(/ORDER BY actor\.id\s+FOR SHARE/g) ?? []).length, 2);
  });

  it("rechecks the reciprocal block at paid completion while holding the sorted actor locks", () => {
    const paid = functionDefinition(migration, "grainline_stripe_checkout_order_create");
    const pairLock = paid.indexOf("ORDER BY actor.id\n   FOR UPDATE");
    const blockCheck = paid.indexOf('FROM public."Block" AS source_block');
    assert.ok(pairLock >= 0 && blockCheck > pairLock);
    assert.match(paid, /Buyer and seller could not transact at payment completion\./u);
    assert.match(paid, /source_review_needed := source_invalid_reason <> ''/u);
    assert.match(paid, /source_invalid_reason = ''/u);
  });

  it("preserves the reviewed paid authority except for the reciprocal block branch", () => {
    const addition = `
  ELSIF EXISTS (
    SELECT 1
      FROM public."Block" AS source_block
     WHERE (source_block."blockerId" = source_buyer_id
            AND source_block."blockedId" = source_seller_user_id)
        OR (source_block."blockerId" = source_seller_user_id
            AND source_block."blockedId" = source_buyer_id)
  ) THEN
    source_buyer_invalid_reason :=
      'Buyer and seller could not transact at payment completion.';`;
    const candidate = functionDefinition(migration, "grainline_stripe_checkout_order_create");
    assert.equal(candidate.includes(addition), true);
    assert.equal(
      candidate.replace(addition, ""),
      functionDefinition(paidPredecessor, "grainline_stripe_checkout_order_create"),
    );
  });
});
