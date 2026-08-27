import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
  buildBlockedCheckoutTransferBindingMigration,
  verifyBlockedCheckoutTransferBindingMigrationBytes,
} = await import("../scripts/build-blocked-checkout-transfer-binding-migration.mjs");
const {
  parseBlockedCheckoutTransferBindingProofConfig,
} = await import("../scripts/blocked-checkout-transfer-binding-postgres-proof.mjs");

test("blocked-checkout transfer binding migration is byte pinned", () => {
  const proof = verifyBlockedCheckoutTransferBindingMigrationBytes();
  assert.equal(
    BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    "20260826010000_prepare_blocked_checkout_transfer_binding",
  );
  assert.equal(
    proof.migrationSha256,
    BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
  );
  assert.equal(
    readFileSync(proof.migrationPath, "utf8"),
    buildBlockedCheckoutTransferBindingMigration(),
  );
});

test("blocked-checkout transfer binding is narrow, source-fenced and runtime-only", () => {
  const migration = buildBlockedCheckoutTransferBindingMigration();
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = pg_catalog/);
  assert.match(migration, /locked_event\."claimGeneration" IS DISTINCT FROM p_event_claim_generation/);
  assert.match(migration, /p_payment_intent_id IS NULL/);
  assert.match(migration, /p_charge_id IS NULL/);
  assert.match(migration, /p_transfer_id IS NULL/);
  assert.match(migration, /char_length\(p_transfer_id\) NOT BETWEEN 1 AND 255/);
  assert.match(migration, /locked_event\."processedAt" IS NOT NULL/);
  assert.match(migration, /locked_order\."stripePaymentIntentId" IS DISTINCT FROM p_payment_intent_id/);
  assert.match(migration, /locked_order\."stripeChargeId" IS DISTINCT FROM p_charge_id/);
  assert.match(migration, /locked_order\."stripeTransferId" IS DISTINCT FROM p_transfer_id/);
  assert.match(migration, /arrived after refund authority/);
  assert.match(migration, /orders\."sellerRefundLockedAt" IS NULL/);
  assert.match(migration, /NOT EXISTS \([\s\S]*payment_event\."eventType" = 'REFUND'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/);
  assert.doesNotMatch(migration, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/);
  assert.doesNotMatch(migration, /EXECUTE\s+FORMAT|dynamic SQL/i);
});

test("real PostgreSQL proof requires separate loopback owner and runtime logins", () => {
  const config = parseBlockedCheckoutTransferBindingProofConfig({
    BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_DATABASE_URL:
      "postgresql://ci:owner@127.0.0.1:5432/grainline_ci",
    BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_RUNTIME_DATABASE_URL:
      "postgresql://grainline_app_runtime:runtime@localhost:5432/grainline_ci",
  });
  assert.match(config.ownerDatabaseUrl, /ci:owner/);
  assert.match(config.runtimeDatabaseUrl, /grainline_app_runtime:runtime/);
  assert.throws(
    () => parseBlockedCheckoutTransferBindingProofConfig({
      BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_DATABASE_URL:
        "postgresql://ci:owner@database.example/grainline_ci",
      BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://grainline_app_runtime:runtime@localhost/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseBlockedCheckoutTransferBindingProofConfig({
      BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_DATABASE_URL:
        "postgresql://ci:owner@localhost/grainline_ci",
      BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_RUNTIME_DATABASE_URL:
        "postgresql://ci:runtime@localhost/grainline_ci",
    }),
    /grainline_app_runtime/,
  );
});
