import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
  buildOrderPaymentSignedRefundIdentityMigration,
  orderPaymentSignedRefundIdentityFunctionSource,
  verifyOrderPaymentSignedRefundIdentityMigrationBytes,
} = await import(
  "../scripts/build-order-payment-signed-refund-identity-migration.mjs"
);

test("signed-refund identity successor is byte pinned", () => {
  const proof = verifyOrderPaymentSignedRefundIdentityMigrationBytes();
  assert.equal(
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    "20260828010000_prepare_order_payment_signed_refund_identity",
  );
  assert.equal(
    proof.migrationSha256,
    ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
  );
  assert.equal(
    readFileSync(proof.migrationPath, "utf8"),
    buildOrderPaymentSignedRefundIdentityMigration(),
  );
  assert.match(
    orderPaymentSignedRefundIdentityFunctionSource(),
    /^\nDECLARE[\s\S]*END\n$/,
  );
});

test("signed-refund identity successor derives only exact durable local evidence", () => {
  const migration = buildOrderPaymentSignedRefundIdentityMigration();
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.grainline_order_payment_signed_refund_apply/);
  assert.match(migration, /p_refund_id IS NULL/);
  assert.match(migration, /local_refund_evidence_count = 1/);
  assert.match(migration, /source_order\."sellerRefundAmountCents"[\s\S]*p_amount_refunded_cents/);
  assert.match(migration, /'SELLER_REFUND_RECORDED'/);
  assert.match(migration, /'CASE_REFUND_RECORDED'/);
  assert.match(migration, /'BLOCKED_CHECKOUT_REFUND_RECORDED'/);
  assert.match(migration, /payment\.metadata->'refundIds'[\s\S]*jsonb_build_array/);
  assert.match(migration, /audit\.metadata->>'orderPaymentEventId' = payment\.id/);
  assert.match(migration, /audit\.metadata->>'stripeRefundId' = source_order\."sellerRefundId"/);
  assert.match(migration, /'localRefundEvidenceId', local_refund_evidence_id/);
  assert.match(migration, /'localRefundEvidenceAction', local_refund_evidence_action/);
  assert.match(migration, /additional_external_refund/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /FROM PUBLIC, grainline_app_runtime/);
  assert.match(migration, /TO grainline_app_runtime/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/);
  assert.doesNotMatch(migration, /EXECUTE\s+FORMAT|dynamic SQL/i);
});

