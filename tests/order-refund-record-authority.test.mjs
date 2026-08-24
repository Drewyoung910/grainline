import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20260824020000_prepare_order_refund_record_authority/migration.sql",
  "utf8",
);
const sellerRoute = readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
  "utf8",
);
const webhookRoute = readFileSync(
  "src/app/api/stripe/webhook/route.ts",
  "utf8",
);
const claimHelper = readFileSync(
  "src/lib/orderRefundClaimAuthority.ts",
  "utf8",
);
const recordHelper = readFileSync(
  "src/lib/orderRefundRecordAuthority.ts",
  "utf8",
);

test("adds three pinned source-bound runtime entrypoints without changing RLS or table grants", () => {
  for (const name of [
    "grainline_blocked_checkout_refund_claim_resume",
    "grainline_seller_refund_record",
    "grainline_blocked_checkout_refund_record",
  ]) {
    assert.match(migration, new RegExp(`CREATE FUNCTION public\\.${name}`));
    assert.match(
      migration,
      new RegExp(
        `REVOKE ALL ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?FROM PUBLIC;`,
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime;`,
      ),
    );
  }
  assert.equal((migration.match(/SECURITY DEFINER/gu) ?? []).length, 3);
  assert.equal(
    (migration.match(/SET search_path = pg_catalog/gu) ?? []).length,
    3,
  );
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /REVOKE ALL ON TABLE/);
  assert.doesNotMatch(migration, /\bEXECUTE\s+[^\n]*\bformat\s*\(/iu);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:greatest|least|nullif|coalesce)\b/iu,
  );
});

test("resumes only the same blocked-checkout claim under an active later signed lease", () => {
  assert.match(
    migration,
    /locked_event\."claimGeneration" IS DISTINCT FROM p_event_claim_generation/,
  );
  assert.match(migration, /locked_event\."processingStartedAt" IS NULL/);
  assert.match(migration, /locked_event\."processedAt" IS NOT NULL/);
  assert.match(
    migration,
    /locked_event\."sourceObjectId" IS DISTINCT FROM p_session_id/,
  );
  assert.match(
    migration,
    /locked_order\."stripeSessionId" IS DISTINCT FROM p_session_id/,
  );
  assert.match(
    migration,
    /locked_order\."refundClaimSourceGeneration" <= locked_event\."claimGeneration"/,
  );
  assert.match(
    migration,
    /"refundClaimIdempotencyScope" IS NOT DISTINCT FROM\s+'blocked-checkout-refund:'/,
  );
  assert.match(
    migration,
    /SET "refundClaimSourceGeneration" = locked_event\."claimGeneration"/,
  );
  assert.match(
    claimHelper,
    /SELECT public\.grainline_blocked_checkout_refund_claim_resume\(/,
  );
});

test("record functions bind the active claim and derive durable payment, stock, Case and audit effects", () => {
  assert.match(
    migration,
    /WHERE orders\."refundClaimId" = p_claim_id\s+AND orders\."refundClaimGeneration" = p_claim_generation/,
  );
  assert.match(
    migration,
    /locked_order\."refundClaimSource" IS DISTINCT FROM 'SELLER'/,
  );
  assert.match(
    migration,
    /locked_order\."refundClaimSource" IS DISTINCT FROM 'BLOCKED_CHECKOUT'/,
  );
  assert.match(
    migration,
    /public\.grainline_case_seller_refund_apply\(\s*locked_actor\.id,\s*payment_event_id/,
  );
  assert.equal(
    (migration.match(/INSERT INTO public\."OrderPaymentEvent"/gu) ?? []).length,
    2,
  );
  assert.equal(
    (migration.match(/INSERT INTO public\."SystemAuditLog"/gu) ?? []).length,
    2,
  );
  assert.equal(
    (migration.match(/'restoredActiveListingCount'/gu) ?? []).length >= 6,
    true,
  );
  assert.match(migration, /'notificationBody'/);
  assert.match(migration, /'action', 'replay'/);
  assert.match(migration, /'action', 'recorded'/);
  assert.doesNotMatch(
    migration,
    /p_(?:order_payment_event_id|stock_quantity|case_id|buyer_user_id|notification_body)/,
  );
});

test("application paths use one typed fixed finalizer for the initial write and exact retry", () => {
  assert.equal(
    (sellerRoute.match(/recordSellerOrderRefund\(/gu) ?? []).length,
    2,
  );
  assert.equal(
    (webhookRoute.match(/recordBlockedCheckoutOrderRefund\(/gu) ?? []).length,
    2,
  );
  assert.match(sellerRoute, /orderRefundProviderEvidence\(refund\)/);
  assert.match(webhookRoute, /orderRefundProviderEvidence\(refund\)/);
  assert.doesNotMatch(sellerRoute, /recordLocalRefundEvidence/);
  assert.doesNotMatch(webhookRoute, /recordLocalRefundEvidence/);
  assert.doesNotMatch(webhookRoute, /restoreReservedStockItems/);
  assert.match(
    recordHelper,
    /input\.claim\.source !== "SELLER" \|\| input\.claim\.sourceGeneration !== null/,
  );
  assert.match(
    recordHelper,
    /input\.claim\.source !== "BLOCKED_CHECKOUT"[\s\S]*input\.claim\.sourceGeneration === null/,
  );
  assert.match(recordHelper, /rows\.length !== 1/);
  assert.match(recordHelper, /Order refund record changed refund identity/);
  assert.match(recordHelper, /Order refund record changed refund amount/);
});

test("provider evidence rejects ambiguous or terminally unsuccessful results", () => {
  assert.match(recordHelper, /value\.refundIds\.length !== 1/);
  assert.match(recordHelper, /value\.refundStatuses\.length !== 1/);
  assert.match(recordHelper, /\["failed", "canceled", "cancelled"\]/);
  assert.match(recordHelper, /\^re_\[A-Za-z0-9\]\+\$/);
  assert.match(recordHelper, /\^trr_\[A-Za-z0-9\]\+\$/);
  assert.match(
    recordHelper,
    /transferReversalAmountCents !== null && transferReversalId === null/,
  );
  assert.match(recordHelper, /expectsTransferReversal/);
  assert.match(
    recordHelper,
    /expectedTransferReversalAmountCents/,
  );
  assert.match(
    migration,
    /Seller refund reversal evidence is missing or mismatched/,
  );
  assert.match(
    migration,
    /Blocked-checkout refund reversal evidence is missing or mismatched/,
  );
});
