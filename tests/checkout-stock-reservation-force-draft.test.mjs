import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildCheckoutStockReservationForceCandidate,
  CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256,
  CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT,
  CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256,
  CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
  CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT,
  CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
} from "../scripts/build-checkout-stock-reservation-force-candidate.mjs";

const force = fs.readFileSync(CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT, "utf8");
const rollback = fs.readFileSync(
  CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT,
  "utf8",
);
const builder = fs.readFileSync(
  "scripts/build-checkout-stock-reservation-force-candidate.mjs",
  "utf8",
);

function copyCandidateInputs() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "grainline-reservation-force-candidate-"),
  );
  for (const relativePath of [
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT,
    "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql",
  ]) {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(relativePath, destination);
  }
  return root;
}

test("FORCE draft changes only the posture bit from exact Phase A", () => {
  assert.equal((force.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((force.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal(
    (force.match(
      /^ALTER TABLE public\."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;$/gm,
    ) ?? []).length,
    1,
  );
  assert.match(force, /class\.relrowsecurity/);
  assert.match(force, /NOT class\.relforcerowsecurity/);
  assert.match(force, /actual_function_count <> 20/);
  assert.match(force, /accepted_function_count <> 20/);
  assert.match(force, /WITH RECURSIVE restricted_members/);
  assert.match(force, /owner-session drain is incomplete/);
  assert.match(force, /pg_catalog\.oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(force, /pg_catalog\.md5\(procedure\.prosrc\)/);
  assert.doesNotMatch(force, /has_any_column_privilege/);
  assert.doesNotMatch(force, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(force, /^\s*(?:GRANT|REVOKE)\b/im);
  assert.doesNotMatch(
    force,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.doesNotMatch(force, /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i);
});

test("FORCE rollback restores policyless ENABLE without grants or RLS disable", () => {
  assert.equal((rollback.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((rollback.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.equal(
    (rollback.match(
      /^ALTER TABLE public\."CheckoutStockReservation" NO FORCE ROW LEVEL SECURITY;$/gm,
    ) ?? []).length,
    1,
  );
  assert.match(rollback, /class\.relrowsecurity/);
  assert.match(rollback, /class\.relforcerowsecurity/);
  assert.match(rollback, /did not restore Phase A/);
  assert.doesNotMatch(rollback, /^\s*(?:GRANT|REVOKE)\b/im);
  assert.doesNotMatch(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bCREATE\s+POLICY\b/i);
});

test("FORCE candidate is byte-pinned, read-only packaging", () => {
  const candidate = buildCheckoutStockReservationForceCandidate();
  assert.equal(candidate.migrationName, CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION);
  assert.equal(
    candidate.migrationSha256,
    CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256,
  );
  assert.equal(candidate.draftSha256, CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256);
  assert.equal(
    candidate.rollbackDraftSha256,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
  );
  assert.doesNotMatch(candidate.migration, /DRAFT ONLY/);
  assert.doesNotMatch(
    builder,
    /\b(?:mkdirSync|writeFileSync|unlinkSync|rmdirSync)\b/,
  );
  assert.match(builder, /mode !== "--verify"/);
  assert.equal(
    fs.existsSync(
      path.join("prisma", "migrations", CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION),
    ),
    false,
  );
});

test("FORCE candidate fails closed on every pinned input", () => {
  for (const relativePath of [
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT,
  ]) {
    const root = copyCandidateInputs();
    try {
      fs.appendFileSync(path.join(root, relativePath), "-- drift\n");
      assert.throws(
        () => buildCheckoutStockReservationForceCandidate(root),
        /byte pin drifted/,
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

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
      () => buildCheckoutStockReservationForceCandidate(root),
      /candidate bytes drifted|omitted pinned function/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
