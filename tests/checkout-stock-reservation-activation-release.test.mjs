import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryBeforeRefundReconciliation } from "./helpers/release-verifier-root.mjs";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256,
  buildCheckoutStockReservationActivationCandidate,
} from "../scripts/build-checkout-stock-reservation-activation-candidate.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
  detectCheckoutStockReservationActivationSuccessors,
  verifyCheckoutStockReservationActivationRelease,
} from "../scripts/verify-checkout-stock-reservation-activation-release.mjs";
import {
  parseCheckoutStockReservationActivationPostflightProofConfig,
} from "../scripts/checkout-stock-reservation-activation-postflight-postgres-proof.mjs";
import {
  verifyPromotedCheckoutStockReservationActivation,
} from "../scripts/stage-checkout-stock-reservation-activation-migration.mjs";

const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const productionWiring = fs.readFileSync(
  "docs/checkout-stock-reservation-activation-production-wiring.md",
  "utf8",
);
const activationPostflightProof = fs.readFileSync(
  "scripts/checkout-stock-reservation-activation-postflight-postgres-proof.mjs",
  "utf8",
);

test("activation release exactly promotes the reviewed policyless candidate", () => {
  const candidate = buildCheckoutStockReservationActivationCandidate();
  const promoted = verifyPromotedCheckoutStockReservationActivation();
  const release = verifyCheckoutStockReservationActivationRelease(
    repositoryBeforeRefundReconciliation(), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: true,
  });

  assert.deepEqual(promoted, candidate);
  assert.equal(
    candidate.migrationName,
    "20260815060000_enable_checkout_stock_reservation_rls",
  );
  assert.equal(
    candidate.migrationSha256,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256,
  );
  assert.equal(
    candidate.draftSha256,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256,
  );
  assert.equal(
    candidate.rollbackDraftSha256,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256,
  );
  assert.equal(release.phase, CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE);
  assert.equal(release.migration, CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION);
  assert.equal(
    release.migrationTreeSha256,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION_TREE_SHA256,
  );
  assert.equal(release.runtimeFunctions, 16);
  assert.equal(release.privateFunctions, 9);
  assert.equal(release.policyCount, 0);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, false);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.guard.sealedPrefix, true);
  assert.equal(
    release.guard.successorPhase,
    "checkout-stock-reservation-force-reviewed",
  );
});

test("activation release remains a sealed prefix under only its reviewed successor", () => {
  const release = verifyCheckoutStockReservationActivationRelease(
    repositoryBeforeRefundReconciliation(), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: true,
  });
  assert.deepEqual(release.guard, {
    phase: CHECKOUT_STOCK_RESERVATION_ACTIVATION_PHASE,
    sealedPrefix: true,
    successorPhase: "checkout-stock-reservation-force-reviewed",
  });
  assert.throws(
    () => verifyCheckoutStockReservationActivationRelease(),
    /requires 20260815060000_enable_checkout_stock_reservation_rls to remain the latest migration/,
  );
  assert.throws(
    () => verifyCheckoutStockReservationActivationRelease(undefined, {
      allowReviewedRefundRecordSuccessor: true,
    }),
    /refund record successor requires reviewed reservation successors/i,
  );
});

test("CI isolates predecessors, applies activation, audits it, and proves direct runtime identity", () => {
  const verifyActivation = ci.indexOf(
    "Verify CheckoutStockReservation activation migration tree",
  );
  const isolateActivation = ci.indexOf(
    "Isolate CheckoutStockReservation activation until source consistency passes",
  );
  const verifySource = ci.indexOf(
    "Verify CheckoutStockReservation source-consistency migration tree",
  );
  const restoreActivation = ci.indexOf(
    "Restore CheckoutStockReservation activation release",
  );
  const applyActivation = ci.indexOf(
    "Apply CheckoutStockReservation policyless activation",
  );
  const auditActivation = ci.indexOf(
    "Audit activated reservation grants and RLS catalog",
  );
  const runtimeProof = ci.indexOf(
    "Prove CheckoutStockReservation activation through the actual runtime login",
  );

  assert.ok(verifyActivation >= 0);
  assert.ok(verifyActivation < isolateActivation);
  assert.ok(isolateActivation < verifySource);
  assert.ok(verifySource < restoreActivation);
  assert.ok(restoreActivation < applyActivation);
  assert.ok(applyActivation < auditActivation);
  assert.ok(auditActivation < runtimeProof);
  assert.match(
    ci,
    /CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL: postgresql:\/\/grainline_app_runtime:/,
  );
  assert.match(
    activationPostflightProof,
    /detectCheckoutStockReservationActivationSuccessors\(\)/u,
  );
});

test("production workflow preserves the reviewed activation beneath sealed successors", () => {
  const verifyTree = production.indexOf(
    "Verify exact CheckoutStockReservation activation migration tree",
  );
  const verifyRelease = production.indexOf(
    "Verify exact CheckoutStockReservation activation release",
  );
  const isolateActivation = production.indexOf(
    "Isolate the reviewed CheckoutStockReservation activation",
  );
  const verifySource = production.indexOf(
    "Verify exact CheckoutStockReservation source-consistency migration tree",
  );
  const restoreSource = production.indexOf(
    "Restore the reviewed CheckoutStockReservation source-consistency successor",
  );
  const restoreActivation = production.indexOf(
    "Restore the reviewed CheckoutStockReservation activation",
  );
  const restoreForce = production.indexOf(
    "Restore the reviewed CheckoutStockReservation FORCE release",
  );
  const restorePayoutActivation = production.indexOf(
    "Restore the reviewed SellerPayoutEvent FORCE release",
  );
  const restartScope = production.indexOf(
    "Inspect exact SellerPayoutEvent FORCE restart scope read-only",
  );
  const apply = production.indexOf("Apply production migrations");
  const afterScope = production.indexOf(
    "Prove exact SellerPayoutEvent FORCE production scope",
  );

  assert.ok(verifyTree >= 0);
  assert.ok(verifyTree < verifyRelease);
  assert.ok(verifyRelease < isolateActivation);
  assert.ok(isolateActivation < verifySource);
  assert.ok(verifySource < restoreSource);
  assert.ok(restoreSource < restoreActivation);
  assert.ok(restoreActivation < restoreForce);
  assert.ok(restoreForce < restorePayoutActivation);
  assert.ok(restorePayoutActivation < restartScope);
  assert.ok(restartScope < apply);
  assert.ok(apply < afterScope);
  assert.match(
    production,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-activation-reviewed/u,
  );
  assert.match(
    production,
    /20260815060000_enable_checkout_stock_reservation_rls/u,
  );
  assert.match(
    production,
    /SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: restart/u,
  );
  assert.match(
    production,
    /SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE: after/u,
  );
  const isolateForce = production.indexOf(
    "Isolate the reviewed CheckoutStockReservation FORCE release",
  );
  assert.ok(isolateForce >= 0 && isolateForce < isolateActivation);
  assert.ok(restoreActivation < restoreForce);
  assert.ok(restoreForce < restorePayoutActivation);
});

test("production wiring record pins completed Phase A and keeps FORCE separate", () => {
  assert.match(
    productionWiring,
    /5817dea6725f7f2eb7fde3da1f546aa75dd449b1/u,
  );
  assert.match(productionWiring, /31892857440/u);
  assert.match(
    productionWiring,
    /20260815060000_enable_checkout_stock_reservation_rls/u,
  );
  assert.match(
    productionWiring,
    /7940be1969c89c8bbf5818164a56afb7e8bf7925bd8a26231d8ac865fac7c519/u,
  );
  assert.match(
    productionWiring,
    /405d6dff327bee76aced17f3876f8f18f29e05db/u,
  );
  assert.match(productionWiring, /31894742120/u);
  assert.match(productionWiring, /31903152300/u);
  assert.match(
    productionWiring,
    /899679a14590200880e89d983fff70492632de458649316bd69cde9a0027ece0/u,
  );
  assert.match(productionWiring, /zero-step failed\s+activation row/u);
  assert.match(productionWiring, /separate actual pooled-runtime/u);
  assert.match(productionWiring, /remaining database boundary.*FORCE/su);
  assert.match(productionWiring, /does not authorize FORCE, deployment/u);
});

test("runtime postflight proof accepts only a loopback direct runtime login", () => {
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightProofConfig({
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@production.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseCheckoutStockReservationActivationPostflightProofConfig({
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL:
        "postgresql://ci:secret@localhost/grainline_ci",
    }),
    /grainline_app_runtime/,
  );
  assert.deepEqual(
    parseCheckoutStockReservationActivationPostflightProofConfig({
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_POSTFLIGHT_PROOF_DATABASE_URL:
        "postgresql://grainline_app_runtime:secret@localhost/grainline_ci",
    }),
    {
      databaseUrl:
        "postgresql://grainline_app_runtime:secret@localhost/grainline_ci",
    },
  );
});

test("runtime postflight derives only successors present in the staged migration tree", (t) => {
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "grainline-checkout-activation-successors-",
  ));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const migrations = path.join(root, "prisma/migrations");
  fs.mkdirSync(migrations, { recursive: true });
  const add = (name) => fs.mkdirSync(path.join(migrations, name));

  assert.deepEqual(detectCheckoutStockReservationActivationSuccessors(root), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: false,
    allowReviewedSignedAuthoritySuccessor: false,
  });

  add("20260824020000_prepare_order_refund_record_authority");
  assert.deepEqual(detectCheckoutStockReservationActivationSuccessors(root), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: false,
    allowReviewedSignedAuthoritySuccessor: false,
  });

  add("20260824010000_prepare_order_refund_claim_generation");
  assert.deepEqual(detectCheckoutStockReservationActivationSuccessors(root), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: false,
  });

  add("20260824030000_prepare_order_payment_signed_authority");
  assert.deepEqual(detectCheckoutStockReservationActivationSuccessors(root), {
    allowReviewedSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: true,
  });
});
