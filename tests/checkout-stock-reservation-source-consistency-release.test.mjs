import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT_SHA256,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256,
  buildCheckoutStockReservationSourceConsistencyCandidate,
  verifyPromotedCheckoutStockReservationSourceConsistency,
} from "../scripts/stage-checkout-stock-reservation-source-consistency.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_PHASE,
  verifyCheckoutStockReservationSourceConsistency,
} from "../scripts/verify-checkout-stock-reservation-source-consistency.mjs";
import {
  validateCurrentSavedSearchRlsDeployShape,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  createSealedCheckoutStockReservationSourceConsistencyRoot,
} from "./helpers/sealed-checkout-stock-reservation-authority-root.mjs";

test("source-consistency migration is an exact wrapper around provider-proven bytes", () => {
  const candidate = buildCheckoutStockReservationSourceConsistencyCandidate();
  const promoted = verifyPromotedCheckoutStockReservationSourceConsistency();
  assert.deepEqual(promoted, candidate);
  assert.equal(
    candidate.migrationName,
    "20260814053000_prepare_checkout_stock_reservation_source_consistency",
  );
  assert.equal(
    candidate.draftSha256,
    "863a731c1e0651f8a91c38f1b614f2a92fc5edd7eb741929aa5a223a71b75bd2",
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT_SHA256,
    candidate.draftSha256,
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION,
    candidate.migrationName,
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256,
    candidate.migrationSha256,
  );
  assert.match(candidate.migration, /^-- Additive CheckoutStockReservation source-consistency authority\./u);
  assert.match(candidate.migration, /\nBEGIN;\n/u);
  assert.match(candidate.migration, /\nCOMMIT;\n$/u);
  assert.doesNotMatch(candidate.migration, /ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY/iu);
  assert.doesNotMatch(candidate.migration, /ON TABLE public\."CheckoutStockReservation"/iu);
});

test("source-consistency release has a distinct byte-pinned migration phase", (t) => {
  const sealedRoot = createSealedCheckoutStockReservationSourceConsistencyRoot();
  t.after(() => fs.rmSync(sealedRoot, { recursive: true, force: true }));
  const verified = verifyCheckoutStockReservationSourceConsistency();
  assert.equal(
    verified.phase,
    "checkout-stock-reservation-source-consistency-reviewed",
  );
  assert.equal(verified.runtimeOperations, 18);
  assert.equal(verified.privateHelpers, 7);
  assert.equal(verified.rlsChanged, false);
  assert.equal(verified.tableGrantsChanged, false);
  assert.equal(verified.predecessorCreateAuthorityRetained, true);
  assert.deepEqual(
    validateCurrentSavedSearchRlsDeployShape({
      phase: CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_PHASE,
      rootDirectory: sealedRoot,
    }),
    {
      phase: CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_PHASE,
      hasStripeWebhookEventForceMigration: true,
      hasCheckoutStockReservationAuthorityMigration: true,
      hasCheckoutStockReservationSourceConsistencyMigration: true,
    },
  );
});

test("source-consistency release contains no temporary provider artifact", () => {
  const forbidden = [
    "scripts/checkout-stock-reservation-provider-proof-operator.mjs",
    "src/app/api/internal/rls-context-gate/route.ts",
    "src/lib/checkoutStockReservationProviderConfig.ts",
    "src/lib/checkoutStockReservationProviderGate.ts",
    "tests/checkout-stock-reservation-provider-operator.test.mjs",
    "tests/checkout-stock-reservation-provider-runner.test.mjs",
  ];
  for (const pathname of forbidden) {
    assert.equal(fs.existsSync(path.resolve(pathname)), false, pathname);
  }
  const middleware = fs.readFileSync("src/middleware.ts", "utf8");
  assert.doesNotMatch(middleware, /\/api\/internal\/rls-context-gate/u);
});

test("source-consistency release records the exact production and pooled-runtime boundaries", () => {
  const record = fs.readFileSync(
    "docs/checkout-stock-reservation-source-consistency-release.md",
    "utf8",
  );
  assert.match(
    record,
    /16239fce2956c6dc726c24ccd7a91d1ea35463bd/u,
  );
  assert.match(record, /exact-main CI run\s+`31813433933`/u);
  assert.match(record, /production migration run `31814032227`/u);
  assert.match(record, /state: source-consistent/u);
  assert.match(record, /zero reservation activation rows/u);
  assert.match(record, /zero\s+reservation FORCE rows/u);
  assert.match(record, /RLS remains off/u);
  assert.match(
    record,
    /ac4c9d2139f5294c5e91edd24acb3dbe71b4976c/u,
  );
  assert.match(record, /exact-main CI run\s+`31819848330`/u);
  assert.match(record, /migration-main CI run `31813433933`/u);
  assert.match(record, /successful migration run `31814032227`/u);
  assert.match(record, /pooled `grainline_app_runtime` role/u);
  assert.match(record, /SQLSTATE `25006`/u);
  assert.match(record, /productionChangedByPostflight: false/u);
  assert.match(
    record,
    /bec37f40d995e311bee5d80fc63c3485f7d325cdcd846b88656684fe2f592afe/u,
  );
});

test("CI proves the successor before isolating it and then seals the predecessor", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const verifySuccessor = workflow.indexOf(
    "Verify CheckoutStockReservation source-consistency release",
  );
  const isolateSuccessor = workflow.indexOf(
    "Isolate CheckoutStockReservation source consistency until authority passes",
  );
  const verifyPredecessor = workflow.indexOf(
    "Verify sealed CheckoutStockReservation authority predecessor",
  );
  const isolatePredecessor = workflow.indexOf(
    "Isolate CheckoutStockReservation authority until webhook FORCE passes",
  );
  const restoreSuccessor = workflow.indexOf(
    "Restore CheckoutStockReservation source-consistency release",
  );
  const verifyPredecessorStatus = workflow.indexOf(
    "Verify CheckoutStockReservation authority migration status",
  );
  const proveSuccessor = workflow.indexOf(
    "Prove CheckoutStockReservation source successor before application",
  );
  const applySuccessor = workflow.indexOf(
    "Apply CheckoutStockReservation source-consistency authority",
  );
  assert.ok(verifySuccessor >= 0);
  assert.ok(verifySuccessor < isolateSuccessor);
  assert.ok(isolateSuccessor < verifyPredecessor);
  assert.ok(verifyPredecessor < isolatePredecessor);
  assert.ok(isolatePredecessor < verifyPredecessorStatus);
  assert.ok(verifyPredecessorStatus < restoreSuccessor);
  assert.ok(restoreSuccessor < proveSuccessor);
  assert.ok(proveSuccessor < applySuccessor);
});

test("production wiring preserves source consistency as the sealed activation predecessor", () => {
  const workflow = fs.readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  const isolateActivation = workflow.indexOf(
    "Isolate the reviewed CheckoutStockReservation activation",
  );
  const verifySource = workflow.indexOf(
    "Verify exact CheckoutStockReservation source-consistency migration tree",
  );
  const isolateSource = workflow.indexOf(
    "Isolate the reviewed CheckoutStockReservation source-consistency successor",
  );
  const verifyAuthority = workflow.indexOf(
    "Verify exact CheckoutStockReservation authority migration tree after isolation",
  );
  const restoreSource = workflow.indexOf(
    "Restore the reviewed CheckoutStockReservation source-consistency successor",
  );
  const restoreActivation = workflow.indexOf(
    "Restore the reviewed CheckoutStockReservation activation",
  );
  const restoreForce = workflow.indexOf(
    "Restore the reviewed CheckoutStockReservation FORCE release",
  );
  const restartScope = workflow.indexOf(
    "Inspect exact CheckoutStockReservation FORCE restart scope read-only",
  );
  const apply = workflow.indexOf("Apply production migrations");
  const converge = workflow.indexOf(
    "Converge exact FORCE-hardened CheckoutStockReservation runtime grants",
  );
  const status = workflow.indexOf("Verify production migration status");
  const finalScope = workflow.indexOf(
    "Prove exact CheckoutStockReservation FORCE production scope",
  );
  assert.ok(isolateActivation >= 0);
  assert.ok(isolateActivation < verifySource);
  assert.ok(verifySource < isolateSource);
  assert.ok(isolateSource < verifyAuthority);
  assert.ok(verifyAuthority < restoreSource);
  assert.ok(restoreSource < restoreActivation);
  assert.ok(restoreActivation < restoreForce);
  assert.ok(restoreForce < restartScope);
  assert.ok(restartScope < apply);
  assert.ok(apply < converge);
  assert.ok(converge < status);
  assert.ok(status < finalScope);
  assert.match(
    workflow.slice(converge, status),
    /-v runtime_role=grainline_app_runtime[\s\S]*-v migration_role=neondb_owner/u,
  );
});
