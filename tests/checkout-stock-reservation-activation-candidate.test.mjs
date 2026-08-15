import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCheckoutStockReservationActivationCandidate,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT,
  CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256,
} from "../scripts/build-checkout-stock-reservation-activation-candidate.mjs";

const builderSource = fs.readFileSync(
  "scripts/build-checkout-stock-reservation-activation-candidate.mjs",
  "utf8",
);

function copyCandidateInputs() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-reservation-activation-candidate-"),
  );
  for (const relativePath of [
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT,
    "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql",
    "prisma/migrations/20260814053000_prepare_checkout_stock_reservation_source_consistency/migration.sql",
  ]) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(relativePath, destination);
  }
  return root;
}

test("activation candidate is exact, policyless and production-inert", () => {
  const candidate = buildCheckoutStockReservationActivationCandidate();
  assert.equal(
    candidate.migrationName,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
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
  assert.match(
    candidate.migration,
    /^-- Promoted reviewed policyless CheckoutStockReservation ENABLE activation\./,
  );
  assert.match(
    candidate.migration,
    /ALTER TABLE public\."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    candidate.migration,
    /REVOKE ALL ON TABLE public\."CheckoutStockReservation"/,
  );
  assert.match(
    candidate.migration,
    /REVOKE EXECUTE ON FUNCTION[\s\S]*grainline_checkout_reservation_create_cart[\s\S]*grainline_checkout_reservation_create_single[\s\S]*FROM PUBLIC, grainline_app_runtime/,
  );
  assert.doesNotMatch(candidate.migration, /DRAFT ONLY/);
  assert.doesNotMatch(candidate.migration, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(
    candidate.migration,
    /(?<!NO )\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
  );
  assert.doesNotMatch(
    candidate.migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
});

test("candidate builder has no filesystem staging or production execution mode", () => {
  assert.doesNotMatch(
    builderSource,
    /\b(?:mkdirSync|writeFileSync|unlinkSync|rmdirSync)\b/,
  );
  assert.match(builderSource, /mode !== "--verify"/);
  assert.equal(
    fs.existsSync(
      path.join(
        "prisma",
        "migrations",
        CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
      ),
    ),
    false,
  );
});

test("candidate builder fails closed on activation or rollback byte drift", () => {
  for (const relativePath of [
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT,
  ]) {
    const root = copyCandidateInputs();
    try {
      fs.appendFileSync(path.join(root, relativePath), "-- drift\n");
      assert.throws(
        () => buildCheckoutStockReservationActivationCandidate(root),
        /byte pin drifted/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test("candidate builder fails closed when promoted authority function bytes drift", () => {
  const root = copyCandidateInputs();
  try {
    const authorityPath = path.join(
      root,
      "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql",
    );
    const authority = fs.readFileSync(authorityPath, "utf8");
    const drifted = authority.replace(
      /(CREATE FUNCTION public\.grainline_stripe_webhook_bind_source[\s\S]*?\nAS \$[A-Za-z0-9_]+\$\n)/,
      "$1-- source drift\n",
    );
    assert.notEqual(drifted, authority);
    fs.writeFileSync(authorityPath, drifted, "utf8");
    assert.throws(
      () => buildCheckoutStockReservationActivationCandidate(root),
      /candidate bytes drifted|omitted pinned function/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
