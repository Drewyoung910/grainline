import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const path =
  "prisma/migrations/20260824040000_prepare_order_refund_reconciliation_authority/migration.sql";
const migration = readFileSync(path, "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");
const provider = readFileSync(
  "src/lib/orderRefundProviderReconciliation.ts",
  "utf8",
);
const marketplaceRefunds = readFileSync(
  "src/lib/marketplaceRefunds.ts",
  "utf8",
);
const webhook = readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
const refundClaimAuthority = readFileSync(
  "prisma/migrations/20260824010000_prepare_order_refund_claim_generation/migration.sql",
  "utf8",
);
const sellerRefund = readFileSync(
  "src/app/api/orders/[id]/refund/route.ts",
  "utf8",
);
const reconciliationState = readFileSync(
  "src/lib/orderRefundReconciliationState.ts",
  "utf8",
);
const adminAction = readFileSync(
  "src/app/admin/orders/[id]/refundReconciliationActions.ts",
  "utf8",
);
const adminComponent = readFileSync(
  "src/app/admin/orders/[id]/AdminOrderActions.tsx",
  "utf8",
);

test("creates a private immutable ledger and four fixed refund recovery operations", () => {
  assert.match(schema, /model OrderRefundReconciliation \{/);
  assert.match(migration, /CREATE TABLE public\."OrderRefundReconciliation"/);
  assert.match(
    migration,
    /ALTER TABLE public\."OrderRefundReconciliation" ENABLE ROW LEVEL SECURITY;[\s\S]*FORCE ROW LEVEL SECURITY;/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON TABLE public\."OrderRefundReconciliation"[\s\S]*FROM PUBLIC, grainline_app_runtime;/,
  );
  assert.equal((migration.match(/SECURITY DEFINER/gu) ?? []).length, 4);
  assert.equal(
    (migration.match(/SET search_path = pg_catalog/gu) ?? []).length,
    5,
  );
  assert.doesNotMatch(migration, /CREATE POLICY/);
  assert.match(
    migration,
    /CREATE TRIGGER grainline_order_refund_reconciliation_immutable[\s\S]*BEFORE UPDATE OR DELETE/,
  );
  assert.doesNotMatch(migration, /\bEXECUTE\s+[^\n]*\bformat\s*\(/iu);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:greatest|least|nullif|coalesce)\b/iu,
  );
});

test("binds blocked-checkout finalization to immutable reconciliation after the failed lease clears", () => {
  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_blocked_checkout_refund_reconciliation_record\(/,
  );
  assert.match(
    migration,
    /source_reconciliation\."claimSource" <> 'BLOCKED_CHECKOUT'/,
  );
  assert.match(
    migration,
    /source_reconciliation\.action NOT IN \([\s\S]*'RETRY_EXISTING_SCOPE',[\s\S]*'CONFIRMED_PROVIDER_EFFECT'/,
  );
  assert.match(
    migration,
    /locked_event\."processingStartedAt" IS NOT NULL[\s\S]*locked_event\."processedAt" IS NOT NULL/,
  );
  assert.match(
    migration,
    /public\.grainline_blocked_checkout_refund_record_core\(/,
  );
  assert.match(
    migration,
    /SET "processedAt" = source_now,[\s\S]*"lastError" = NULL/,
  );
  assert.match(
    adminAction,
    /reconciled\.reconciliationId/,
  );
});

test("uses one fixed exact-claim ambiguous transition from every provider failure path", () => {
  assert.match(
    migration,
    /CREATE FUNCTION public\.grainline_order_refund_claim_mark_ambiguous\(/,
  );
  assert.match(migration, /p_reason_code NOT IN \(/);
  assert.doesNotMatch(migration, /review_note\s*:=\s*p_/);
  assert.doesNotMatch(sellerRefund, /reason: "SELLER_CLAIM_DRIFT"/);
  assert.match(sellerRefund, /reason: "SELLER_PROVIDER_AMBIGUOUS"/);
  assert.match(webhook, /reason: "BLOCKED_CHECKOUT_PROVIDER_AMBIGUOUS"/);
  assert.doesNotMatch(
    `${sellerRefund}\n${webhook}`,
    /sellerRefundId:\s*REFUND_AMBIGUOUS_SENTINEL/,
  );
});

test("pins admin reconciliation to session-bound PIN, current ADMIN and derived outcome", () => {
  assert.match(adminAction, /const \{ userId, sessionId \} = await auth\(\)/);
  assert.match(adminAction, /verifyAdminPinCookieValue\(/);
  assert.match(adminAction, /ADMIN_PIN_COOKIE_NAME/);
  assert.match(adminAction, /admin\.role !== "ADMIN"/);
  assert.match(adminAction, /safeRateLimit\(adminActionRatelimit, userId\)/);
  assert.match(
    adminAction,
    /inspectOrderRefundProviderEffect\(preparedClaim, \{[\s\S]*providerAuthorizedAtSeconds:[\s\S]*preparedClaim\.providerAuthorizedAtSeconds/,
  );
  assert.match(
    adminAction,
    /chooseOrderRefundReconciliationAction\([\s\S]*preparedClaim,[\s\S]*inspection/,
  );
  assert.doesNotMatch(adminAction, /formData\.get\("action"\)/);
  assert.match(reconciliationState, /RETRY_WINDOW_SECONDS = 23/);
  assert.match(reconciliationState, /RELEASE_WINDOW_SECONDS = 25/);
  assert.match(adminComponent, /Inspect Stripe and reconcile exact claim/);
});

test("binds reconciliation to a current ADMIN, exact claim, fresh digest, and closed outcomes", () => {
  assert.match(
    migration,
    /source_actor\.role <> 'ADMIN'::public\."Role"/,
  );
  assert.match(
    migration,
    /orders\."refundClaimId" = p_claim_id[\s\S]*orders\."refundClaimGeneration" = p_claim_generation[\s\S]*FOR UPDATE/,
  );
  assert.match(migration, /source_now - INTERVAL '10 minutes'/);
  assert.match(migration, /source_now \+ INTERVAL '5 minutes'/);
  assert.match(
    migration,
    /char_length\(normalized_reason\) NOT BETWEEN 10 AND 1000/,
  );
  assert.match(migration, /INTERVAL '23 hours'/);
  assert.match(migration, /INTERVAL '25 hours'/);
  assert.match(
    migration,
    /'RETRY_EXISTING_SCOPE'[\s\S]*'CONFIRMED_PROVIDER_EFFECT'[\s\S]*'CONFIRMED_NO_PROVIDER_EFFECT'/,
  );
  assert.match(
    migration,
    /payment_event\.metadata->>'refundClaimId' = p_claim_id/,
  );
  assert.match(migration, /INSERT INTO public\."AdminAuditLog"/);
  assert.match(migration, /INSERT INTO public\."OrderRefundReconciliation"/);
});

test("anchors provider requests and recovery scans to the database claim", () => {
  for (const key of [
    "grainline_refund_claim_id",
    "grainline_refund_claim_generation",
    "grainline_refund_claim_source",
    "grainline_refund_idempotency_scope",
    "grainline_refund_component",
  ]) {
    assert.match(`${provider}\n${marketplaceRefunds}`, new RegExp(key));
  }
  assert.match(provider, /payment_intent: claim\.paymentIntentId/);
  assert.match(provider, /MAX_REFUND_SCAN_PAGES = 20/);
  assert.match(provider, /matches\.length > 1/);
  assert.match(provider, /plausibleUntagged\.length > 0/);
  assert.match(provider, /providerAuthorizedAtSeconds - 5 \* 60/);
  assert.match(provider, /SAFE_IDEMPOTENCY_RETRY_MS = 23/);
  assert.match(webhook, /claimBlockedCheckoutOrderRefund\(\{[\s\S]*eventId: event\.id/);
  assert.match(
    refundClaimAuthority,
    /locked_order\."refundClaimSource" = 'BLOCKED_CHECKOUT'[\s\S]*locked_order\."refundClaimSourceId" = locked_event\.id/,
  );
});

test("keeps OrderPaymentEvent RLS and predecessor grants unchanged while staging the sealed production prefix", () => {
  assert.doesNotMatch(
    migration,
    /ALTER TABLE public\."OrderPaymentEvent" (?:ENABLE|FORCE|DISABLE|NO FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(
    migration,
    /(?:GRANT|REVOKE)[\s\S]*ON TABLE public\."OrderPaymentEvent"/,
  );
  const productionWorkflow = readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  const migrationPath =
    "prisma/migrations/20260824040000_prepare_order_refund_reconciliation_authority";
  const verify = productionWorkflow.indexOf(
    "Verify Order refund reconciliation authority release",
  );
  const isolate = productionWorkflow.indexOf(migrationPath);
  const restore = productionWorkflow.lastIndexOf(migrationPath);
  const apply = productionWorkflow.indexOf("Apply production migrations");
  assert.equal(productionWorkflow.split(migrationPath).length - 1, 2);
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < restore && restore < apply);
});
