import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const migrationPath =
  "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql";
const sql = readFileSync(migrationPath, "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("adds a coexistence-safe generation-fenced refund claim tuple", () => {
  for (const field of [
    "refundClaimId",
    "refundClaimGeneration",
    "refundClaimSource",
    "refundClaimSourceId",
    "refundClaimSourceGeneration",
    "refundClaimIdempotencyScope",
    "refundClaimProviderAuthorizedAt",
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
    assert.match(sql, new RegExp(`ADD COLUMN "${field}"`));
  }
  assert.match(schema, /refundClaimGeneration\s+BigInt\s+@default\(0\)/);
  assert.match(sql, /"refundClaimGeneration" >= 0/);
  assert.match(sql, /"refundClaimSource" IN \('SELLER', 'BLOCKED_CHECKOUT'\)/);
  assert.match(
    sql,
    /"sellerRefundId" IS NOT NULL[\s\S]*"sellerRefundId" IN \([\s\S]*'pending'[\s\S]*'ambiguous_refund_pending_reconciliation'/,
  );
  assert.match(sql, /"refundClaimSource" = 'SELLER'[\s\S]*"refundClaimSourceGeneration" IS NULL/);
  assert.match(sql, /"refundClaimSource" = 'BLOCKED_CHECKOUT'[\s\S]*"refundClaimSourceGeneration" >= 1/);
});

test("derives seller claims from the locked actor, seller, Order and payment state", () => {
  assert.match(sql, /grainline_seller_refund_claim\(\s*p_actor_user_id text,\s*p_order_id text/);
  assert.match(sql, /FROM public\."User" AS actor[\s\S]*FOR UPDATE/);
  assert.match(sql, /FROM public\."SellerProfile" AS seller[\s\S]*FOR UPDATE/);
  assert.match(sql, /FROM public\."Order" AS orders[\s\S]*FOR UPDATE/);
  assert.match(sql, /locked_order\."sellerProfileId" IS DISTINCT FROM locked_seller\.id/);
  assert.match(sql, /locked_order\."caseResolutionClaimId" IS NOT NULL/);
  assert.match(sql, /payment_event\."eventType" = 'REFUND'/);
  assert.match(sql, /latest_dispute/);
  assert.match(sql, /claim_generation := locked_order\."refundClaimGeneration" \+ 1/);
  assert.match(sql, /claim_id := 'order_refund_claim_' \|\| pg_catalog\.gen_random_uuid\(\)::text/);
  assert.doesNotMatch(sql, /p_(?:claim_id|claim_generation|refund_amount_cents|idempotency_scope)/);
});

test("binds blocked-checkout claims to the active signed event generation and session", () => {
  assert.match(sql, /grainline_blocked_checkout_refund_claim/);
  assert.match(
    sql,
    /locked_event\.type NOT IN \([\s\S]*'checkout\.session\.completed'[\s\S]*'checkout\.session\.async_payment_succeeded'/,
  );
  assert.match(sql, /locked_event\."claimGeneration" IS DISTINCT FROM p_event_claim_generation/);
  assert.match(sql, /locked_event\."sourceObjectId" IS DISTINCT FROM p_session_id/);
  assert.match(sql, /locked_order\."stripeSessionId" IS DISTINCT FROM p_session_id/);
  assert.match(sql, /claim_amount IS DISTINCT FROM p_expected_amount_cents/);
  assert.match(sql, /"refundClaimSource" = 'BLOCKED_CHECKOUT'/);
  assert.match(sql, /"refundClaimSourceGeneration" = locked_event\."claimGeneration"/);
});

test("marks provider authorization before returning either claim", () => {
  const assignments = sql.match(/"refundClaimProviderAuthorizedAt" = transition_at/g) ?? [];
  assert.equal(assignments.length, 2);
  assert.match(sql, /'action', 'replay'/);
  assert.match(sql, /'action', 'claimed'/);
  assert.doesNotMatch(sql, /refundClaimProviderAuthorizedAt" = NULL/);
});

test("keeps the preparation compatible and both functions narrowly executable", () => {
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /REVOKE ALL ON TABLE/);
  for (const name of [
    "grainline_seller_refund_claim",
    "grainline_blocked_checkout_refund_claim",
  ]) {
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${name}`));
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime`));
  }
  assert.doesNotMatch(sql, /\bEXECUTE\s+[^\n]*\bformat\s*\(/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:greatest|least|nullif|coalesce)\b/i);
});
