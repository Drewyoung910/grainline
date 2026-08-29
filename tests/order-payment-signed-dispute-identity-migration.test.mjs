import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
  buildOrderPaymentSignedDisputeIdentityMigration,
  orderPaymentSignedDisputeIdentityFunctionSource,
  verifyOrderPaymentSignedDisputeIdentityMigrationBytes,
} = await import(
  "../scripts/build-order-payment-signed-dispute-identity-migration.mjs"
);

test("signed-dispute identity successor is derived and byte pinned", () => {
  const proof = verifyOrderPaymentSignedDisputeIdentityMigrationBytes();
  assert.equal(
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    "20260828020000_correct_order_payment_signed_dispute_identity",
  );
  assert.equal(
    proof.migrationSha256,
    ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
  );
  assert.equal(
    readFileSync(proof.migrationPath, "utf8"),
    buildOrderPaymentSignedDisputeIdentityMigration(),
  );
  assert.match(
    orderPaymentSignedDisputeIdentityFunctionSource(),
    /^\nDECLARE[\s\S]*END\n$/,
  );
});

test("signed-dispute identity successor accepts only Stripe's canonical du_ identity", () => {
  const migration = buildOrderPaymentSignedDisputeIdentityMigration();
  assert.match(
    migration,
    /CREATE OR REPLACE FUNCTION public\.grainline_order_payment_signed_dispute_apply/,
  );
  assert.match(migration, /p_dispute_id !~ '\^du_\[A-Za-z0-9\]\+\$'/);
  assert.doesNotMatch(migration, /p_dispute_id !~ '\^dp_/);
  assert.match(migration, /source_event\."sourceObjectId" IS DISTINCT FROM p_dispute_id/);
  assert.match(migration, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /FROM PUBLIC, grainline_app_runtime/);
  assert.match(migration, /TO grainline_app_runtime/);
  assert.doesNotMatch(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/);
  assert.doesNotMatch(migration, /EXECUTE\s+FORMAT|dynamic SQL/i);
});
