import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";
import {
  buildCheckoutStockReservationAuthorityCandidate,
} from "../scripts/stage-checkout-stock-reservation-authority.mjs";
import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_PHASE,
  verifyCheckoutStockReservationAuthority,
} from "../scripts/verify-checkout-stock-reservation-authority.mjs";

const candidate = buildCheckoutStockReservationAuthorityCandidate();
const verified = verifyCheckoutStockReservationAuthority();
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const schema = fs.readFileSync("prisma/schema.prisma", "utf8");
const release = fs.readFileSync(
  "docs/checkout-stock-reservation-authority-release.md",
  "utf8",
);

test("candidate is byte-pinned and preserves the compatible boundary", () => {
  assert.equal(
    candidate.migrationName,
    "20260810190000_prepare_checkout_stock_reservation_authority",
  );
  assert.equal((candidate.migration.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((candidate.migration.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(candidate.migration, /requires the exact FORCE-hardened StripeWebhookEvent predecessor/);
  assert.match(candidate.migration, /ADD COLUMN "sourceObjectId" varchar\(255\)/);
  assert.match(candidate.migration, /ADD COLUMN "repairGeneration" bigint NOT NULL DEFAULT 0/);
  assert.doesNotMatch(candidate.migration, /CheckoutStockReservation"\s+ENABLE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(candidate.migration, /CheckoutStockReservation"\s+FORCE ROW LEVEL SECURITY/i);
  assert.doesNotMatch(
    candidate.migration,
    /(?:GRANT|REVOKE)[\s\S]{0,120}ON TABLE public\."CheckoutStockReservation"/i,
  );
});

test("release verifier pins the full migration prefix and authority catalog", () => {
  assert.equal(verified.phase, CHECKOUT_STOCK_RESERVATION_AUTHORITY_PHASE);
  assert.equal(verified.migrationSha256, candidate.migrationSha256);
  assert.equal(verified.runtimeOperations, 16);
  assert.equal(verified.privateHelpers, 4);
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.filter(
      (entry) => entry.name.startsWith("grainline_checkout_reservation_")
        && entry.runtimeExecute,
    ).length,
    15,
  );
});

test("Prisma schema records every compatible column", () => {
  for (const field of [
    "repairGeneration",
    "repairClaimedAt",
    "repairClaimKind",
    "lastRepairError",
    "lastRepairAttemptAt",
    "sourceObjectId",
  ]) {
    assert.match(schema, new RegExp(`\\b${field}\\b`));
  }
});

test("CI isolates preparation until StripeWebhookEvent FORCE passes", () => {
  const isolate = ci.indexOf("Isolate CheckoutStockReservation authority until webhook FORCE passes");
  const forceProof = ci.indexOf("Prove FORCE-hardened StripeWebhookEvent authority");
  const restore = ci.indexOf("Restore CheckoutStockReservation authority release");
  const apply = ci.indexOf("Apply CheckoutStockReservation compatible authority");
  const audit = ci.indexOf("Audit compatible reservation grants and RLS catalog");
  assert.ok(isolate >= 0);
  assert.ok(forceProof > isolate);
  assert.ok(restore > forceProof);
  assert.ok(apply > restore);
  assert.ok(audit > apply);
});

test("production runner remains intentionally unwired at this checkpoint", () => {
  assert.match(production, /stripe-webhook-event-force-reviewed/);
  assert.doesNotMatch(
    production,
    /checkout-stock-reservation-authority-reviewed/,
  );
  assert.doesNotMatch(
    production,
    /audit:rls-checkout-stock-reservation-authority-release/,
  );
});

test("release record retains exact bytes and the no-production boundary", () => {
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, new RegExp(candidate.draftSha256));
  assert.match(release, new RegExp(verified.migrationTreeSha256));
  assert.match(release, /production migration workflow remains intentionally unwired/i);
  assert.match(
    release,
    /does not enable or FORCE\s+CheckoutStockReservation RLS/i,
  );
});
