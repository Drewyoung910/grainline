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
const banRoute = fs.readFileSync("src/app/api/admin/users/[id]/ban/route.ts", "utf8");
const undoRoute = fs.readFileSync("src/app/api/admin/audit/[id]/undo/route.ts", "utf8");

describe("Order ban review authority", () => {
  it("derives the seller and exact eligible Orders under deterministic locks", () => {
    assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length, 3);
    assert.equal((sql.match(/SECURITY DEFINER/gu) ?? []).length, 3);
    assert.equal((sql.match(/SET search_path = pg_catalog/gu) ?? []).length, 3);
    assert.equal((sql.match(/actor\.role::text = 'ADMIN'/gu) ?? []).length, 3);
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
    assert.match(wrapper, /mintBanReviewCapability/);
    assert.doesNotMatch(wrapper, /client: BanReviewClient = prisma/);
    assert.match(ban, /flagBannedSellerOpenOrders\(\s*banReviewCapability,\s*userId,\s*tx/);
    assert.match(ban, /restoreBannedSellerOrderReviews\(/);
    assert.match(audit, /restoreBannedSellerOrderReviews\(/);
    assert.doesNotMatch(ban, /(?:prisma|tx)\.order\./);
    assert.doesNotMatch(audit, /(?:prisma|tx)\.order\./);
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/gu) ?? []).length, 2);
    assert.match(sql, /OrderStaffCapability[\s\S]*ENABLE ROW LEVEL SECURITY/);
    assert.match(sql, /OrderStaffCapability[\s\S]*FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)/);
  });

  it("requires an isolated one-use capability and route-level Admin PIN", () => {
    assert.match(sql, /SESSION_USER <> 'grainline_staff_read_runtime'/);
    assert.match(sql, /operation = 'BAN_REVIEW_FLAG'/);
    assert.match(sql, /operation = 'BAN_REVIEW_RESTORE'/);
    assert.match(sql, /capability\."payloadHash" = snapshot_hash/);
    assert.match(sql, /capability\."expiresAt" >= pg_catalog\.clock_timestamp\(\)/);
    assert.equal((sql.match(/DELETE FROM public\."OrderStaffCapability" AS capability/gu) ?? []).length, 2);
    assert.match(ban, /mintBanReviewCapability\([\s\S]*'BAN_REVIEW_FLAG'/);
    assert.match(ban, /mintBanReviewCapability\([\s\S]*'BAN_REVIEW_RESTORE'/);
    assert.match(audit, /mintBanReviewCapability\([\s\S]*'BAN_REVIEW_RESTORE'/);
    assert.equal((banRoute.match(/requireStaffAdminPinForApi\(/gu) ?? []).length, 2);
    assert.equal((undoRoute.match(/requireStaffAdminPinForApi\(/gu) ?? []).length, 1);
  });

  it("preserves missing and invalid target policy errors before capability mint", () => {
    assert.match(
      ban,
      /async function requireBanReviewTarget\([\s\S]*select: \{ role: true, deletedAt: true, banned: true, clerkId: true \}[\s\S]*new BanUserPolicyError\('User not found', 404\)[\s\S]*target\.role === 'ADMIN'/u,
    );
    const banFunction = ban.slice(
      ban.indexOf("export async function banUser"),
      ban.indexOf("export async function unbanUser"),
    );
    const unbanFunction = ban.slice(ban.indexOf("export async function unbanUser"));
    assert.ok(
      banFunction.indexOf("await requireBanReviewTarget(userId, 'ban')")
        < banFunction.indexOf("await mintBanReviewCapability("),
    );
    assert.ok(
      unbanFunction.indexOf("await requireBanReviewTarget(userId, 'unban')")
        < unbanFunction.indexOf("await mintBanReviewCapability("),
    );
    assert.match(ban, /source-validating authority boundary across concurrent state changes/u);
  });

  it("keeps already-unbanned Clerk convergence outside the Order capability path", () => {
    const unbanFunction = ban.slice(ban.indexOf("export async function unbanUser"));
    assert.match(
      unbanFunction,
      /const target = await requireBanReviewTarget\(userId, 'unban'\)[\s\S]*if \(!target\.banned\) \{[\s\S]*await convergeAlreadyUnbannedClerkTarget\([\s\S]*return \{ sellerRestoreWarning: null \}[\s\S]*mintBanReviewCapability\(/u,
    );
    assert.match(ban, /idempotentConvergence: true/u);
    assert.match(ban, /originalActionId: clerkSync\.unbanAuditLogId/u);
  });
});
