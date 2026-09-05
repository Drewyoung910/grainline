import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-ban-review-authority.sql",
  "utf8",
);
const wrapper = fs.readFileSync("src/lib/orderBanReviewAuthority.ts", "utf8");
const ban = fs.readFileSync("src/lib/ban.ts", "utf8");
const audit = fs.readFileSync("src/lib/audit.ts", "utf8");

describe("Order ban review authority", () => {
  it("derives the seller and exact eligible Orders under deterministic locks", () => {
    assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length, 2);
    assert.equal((sql.match(/SECURITY DEFINER/gu) ?? []).length, 2);
    assert.equal((sql.match(/SET search_path = pg_catalog/gu) ?? []).length, 2);
    assert.equal((sql.match(/actor\.role::text = 'ADMIN'/gu) ?? []).length, 2);
    assert.equal((sql.match(/target_user\.banned = true/gu) ?? []).length, 2);
    assert.match(sql, /seller\."userId" = p_target_user_id/);
    assert.match(sql, /source_order\."sellerProfileId" = source_seller_profile_id/);
    assert.match(sql, /'PENDING', 'READY_FOR_PICKUP', 'SHIPPED'/);
    assert.match(sql, /source_order\."sellerRefundId" IS NULL/);
    assert.match(sql, /source_order\."paymentRefundBlocked" = false/);
    assert.match(sql, /ORDER BY source_order\.id\s+FOR UPDATE/);
    assert.match(sql, /IF flagged_count > 5000 THEN/);
  });

  it("does not truncate notes and restores only an exact hashed suffix", () => {
    assert.match(sql, /Never truncate existing staff notes/);
    assert.doesNotMatch(sql, /substring\([^)]*,\s*5000|pg_catalog\.left\([^)]*,\s*5000/i);
    assert.match(sql, /pg_catalog\.sha256\(pg_catalog\.convert_to\(prior_note, 'UTF8'\)\)/);
    assert.match(sql, /pg_catalog\.right\([\s\S]*\) = marker_suffix/);
    assert.match(sql, /prior_hash IS DISTINCT FROM snapshot->>'previousReviewNoteHash'/);
    assert.match(sql, /pg_catalog\.char_length\(prior_note\)[\s\S]*previousReviewNoteLength/);
    assert.match(sql, /snapshot is outside the target seller/);
    assert.match(sql, /snapshots contain duplicate Orders/);
    assert.match(sql, /pg_catalog\.jsonb_array_length\(p_snapshots\) > 5000/);
  });

  it("moves both application paths off direct Order authority", () => {
    assert.match(wrapper, /MAX_BAN_ORDER_SNAPSHOTS = 5_000/);
    assert.match(wrapper, /normalizedRows\(rows\)/);
    assert.match(ban, /flagBannedSellerOpenOrders\(adminId, userId, tx\)/);
    assert.match(ban, /restoreBannedSellerOrderReviews\(/);
    assert.match(audit, /restoreBannedSellerOrderReviews\(/);
    assert.doesNotMatch(ban, /(?:prisma|tx)\.order\./);
    assert.doesNotMatch(audit, /(?:prisma|tx)\.order\./);
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/gu) ?? []).length, 2);
    assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)|CREATE POLICY|ENABLE ROW LEVEL SECURITY/);
  });
});
