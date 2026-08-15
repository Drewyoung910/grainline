import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256,
  CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256,
  CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
  buildCheckoutStockReservationForceCandidate,
} from "../scripts/build-checkout-stock-reservation-force-candidate.mjs";
import {
  parseCheckoutStockReservationForceProofConfig,
} from "../scripts/checkout-stock-reservation-force-postgres-proof.mjs";
import {
  parseCheckoutStockReservationForceRollbackProofConfig,
} from "../scripts/checkout-stock-reservation-force-rollback-proof.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_FORCE_PHASE,
  verifyCheckoutStockReservationForceRelease,
} from "../scripts/verify-checkout-stock-reservation-force-release.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260815060001_force_checkout_stock_reservation_rls/migration.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-force-rollback.sql",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const releaseDocument = fs.readFileSync(
  "docs/checkout-stock-reservation-force-release.md",
  "utf8",
);

test("FORCE release is one exact posture-only catalog change", () => {
  const candidate = buildCheckoutStockReservationForceCandidate();
  const release = verifyCheckoutStockReservationForceRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  assert.equal(release.phase, CHECKOUT_STOCK_RESERVATION_FORCE_PHASE);
  assert.equal(release.migration, candidate.migrationName);
  assert.equal(
    candidate.migrationSha256,
    CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256,
  );
  assert.equal(candidate.draftSha256, CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256);
  assert.equal(
    candidate.rollbackDraftSha256,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
  );
  assert.equal(release.runtimeFunctions, 16);
  assert.equal(release.privateFunctions, 9);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, true);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.guard.sealedPrefix, true);
  assert.equal(
    release.guard.reviewedSuccessorMigration,
    "20260815210000_prepare_seller_payout_event_authority",
  );
  assert.throws(
    () => verifyCheckoutStockReservationForceRelease(),
    /requires 20260815060001_force_checkout_stock_reservation_rls to remain the latest migration/,
  );
  assert.equal(
    (migration.match(
      /^ALTER TABLE public\."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;$/gm,
    ) ?? []).length,
    1,
  );
  assert.doesNotMatch(migration, /\bNO\s+FORCE\b/i);
  assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE)\b/im);
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.doesNotMatch(
    migration,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
  );
});

test("FORCE preflight pins Phase A, role graph and complete function authority", () => {
  assert.match(migration, /owner-session drain is incomplete/);
  assert.match(migration, /runtime role retains unreviewed role membership/);
  assert.match(migration, /member\.rolname = 'neondb_owner'/);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/);
  assert.match(migration, /NOT membership\.inherit_option/);
  assert.match(migration, /NOT membership\.set_option/);
  assert.match(migration, /WITH RECURSIVE restricted_members/);
  assert.match(migration, /class\.relrowsecurity/);
  assert.match(migration, /NOT class\.relforcerowsecurity/);
  assert.match(migration, /actual_function_count <> 25/);
  assert.match(migration, /accepted_function_count <> 25/);
  assert.match(migration, /named_runtime_function_count <> 16/);
  assert.match(migration, /WITH expected_runtime\(name, argument_types\)/);
  assert.match(
    migration,
    /procedure\.proname = expected_runtime\.name[\s\S]*oidvectortypes\(procedure\.proargtypes\)[\s\S]*expected_runtime\.argument_types/,
  );
  assert.doesNotMatch(
    migration,
    /procedure\.proname IN \([\s\S]*named_runtime_function_count/,
  );
  assert.match(migration, /table_function_count <> 13/);
  assert.match(migration, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(migration, /pg_catalog\.md5\(procedure\.prosrc\)/);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/i,
  );
});

test("FORCE rollback restores only the accepted Phase-A posture", () => {
  assert.match(
    rollback,
    /ALTER TABLE public\."CheckoutStockReservation" NO FORCE ROW LEVEL SECURITY/,
  );
  assert.match(rollback, /rollback predecessor drifted/);
  assert.match(rollback, /did not restore Phase A/);
  assert.doesNotMatch(rollback, /\b(?:GRANT|REVOKE)\b/i);
  assert.doesNotMatch(
    rollback,
    /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i,
  );
  assert.doesNotMatch(
    rollback,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  const proof = fs.readFileSync(
    "scripts/checkout-stock-reservation-force-rollback-proof.mjs",
    "utf8",
  );
  assert.match(proof, /finally \{/);
  assert.match(proof, /FORCE ROW LEVEL SECURITY/);
  assert.match(proof, /forceRestored: true/);
});

test("disposable FORCE and rollback proofs reject remote or wrong-role URLs", () => {
  assert.throws(() => parseCheckoutStockReservationForceProofConfig({}), /required/);
  assert.throws(
    () => parseCheckoutStockReservationForceProofConfig({
      CHECKOUT_STOCK_RESERVATION_FORCE_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@production.example/neondb",
    }),
    /non-loopback/,
  );
  assert.throws(
    () => parseCheckoutStockReservationForceProofConfig({
      CHECKOUT_STOCK_RESERVATION_FORCE_PROOF_DATABASE_URL:
        "postgresql://ci:secret@localhost/grainline_ci",
    }),
    /grainline_app_runtime/,
  );
  assert.throws(
    () => parseCheckoutStockReservationForceRollbackProofConfig({
      CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline_ci",
    }),
    /non-loopback/,
  );
  assert.throws(
    () => parseCheckoutStockReservationForceRollbackProofConfig({
      CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@localhost/grainline_ci",
    }),
    /ci/,
  );
});

test("CI proves FORCE after Phase A and production wiring preserves the same order", () => {
  const verifyForce = ci.indexOf(
    "Verify CheckoutStockReservation FORCE migration tree",
  );
  const isolateForce = ci.indexOf(
    "Isolate CheckoutStockReservation FORCE until Phase A passes",
  );
  const applyPhaseA = ci.indexOf(
    "Apply CheckoutStockReservation policyless activation",
  );
  const restoreForce = ci.indexOf(
    "Restore CheckoutStockReservation FORCE release",
  );
  const applyForce = ci.indexOf(
    "Apply CheckoutStockReservation FORCE hardening",
  );
  const forceProof = ci.indexOf(
    "Prove FORCE-hardened CheckoutStockReservation authority",
  );
  const rollbackProof = ci.indexOf(
    "Prove CheckoutStockReservation FORCE rollback and restoration",
  );
  assert.ok(verifyForce >= 0 && verifyForce < isolateForce);
  assert.ok(isolateForce < applyPhaseA);
  assert.ok(applyPhaseA < restoreForce && restoreForce < applyForce);
  assert.ok(applyForce < forceProof && forceProof < rollbackProof);
  assert.match(
    ci,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-force-reviewed/,
  );
  const productionVerify = production.indexOf(
    "Verify exact CheckoutStockReservation FORCE migration tree",
  );
  const productionIsolate = production.indexOf(
    "Isolate the reviewed CheckoutStockReservation FORCE release",
  );
  const productionRestore = production.indexOf(
    "Restore the reviewed CheckoutStockReservation FORCE release",
  );
  const productionRestart = production.indexOf(
    "Inspect exact CheckoutStockReservation FORCE restart scope read-only",
  );
  const productionApply = production.indexOf("Apply production migrations");
  const productionAfter = production.indexOf(
    "Prove exact CheckoutStockReservation FORCE production scope",
  );
  assert.ok(productionVerify >= 0 && productionVerify < productionIsolate);
  assert.ok(productionIsolate < productionRestore);
  assert.ok(productionRestore < productionRestart);
  assert.ok(productionRestart < productionApply);
  assert.ok(productionApply < productionAfter);
  assert.match(production, /checkout-stock-reservation-force-reviewed/u);
  assert.match(production, /20260815060001_force_checkout_stock_reservation_rls/u);
  assert.match(
    production,
    /audit:rls-checkout-stock-reservation-force-production-scope/u,
  );
});

test("release record preserves the accepted production FORCE boundary", () => {
  assert.match(releaseDocument, /complete and accepted in production/);
  assert.match(
    releaseDocument,
    /7c033eac8b18f2c7b6837dc8caafa5d3eda47f76/,
  );
  assert.match(releaseDocument, /31912265711/);
  assert.match(
    releaseDocument,
    /4534d58c6a7872d7fae6169e12db56aa62414a16a5e71cad3f4e163c83752d51/,
  );
  assert.match(releaseDocument, /durable ownership-drift invariant/);
  assert.match(releaseDocument, /availability[\s\S]*tradeoff is intentional/);
  assert.match(releaseDocument, /Production acceptance/);
  assert.match(releaseDocument, /No application deploy/);
});
