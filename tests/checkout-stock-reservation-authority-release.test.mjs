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
  assert.match(candidate.migration, /SET LOCAL lock_timeout = '10s'/);
  assert.match(candidate.migration, /SET LOCAL statement_timeout = '120s'/);
  assert.match(candidate.migration, /pg_catalog\.hashtextextended/);
  assert.match(candidate.migration, /IN ACCESS EXCLUSIVE MODE/);
  assert.match(candidate.migration, /runtime_role\.rolinherit/);
  assert.match(candidate.migration, /WITH RECURSIVE restricted_members/);
  assert.match(candidate.migration, /member\.rolname = 'neondb_owner'/);
  assert.match(candidate.migration, /grantor\.rolname = 'cloud_admin'/);
  assert.match(candidate.migration, /NOT membership\.inherit_option/);
  assert.match(candidate.migration, /NOT membership\.set_option/);
  assert.match(candidate.migration, /owner-session drain is incomplete/);
  assert.match(candidate.migration, /has_any_column_privilege/);
  assert.match(candidate.migration, /predecessor retains unreviewed PUBLIC or column authority/);
  assert.match(candidate.migration, /CheckoutStockReservation_status_chk/);
  assert.match(candidate.migration, /CheckoutStockReservation_reservedItems_array_chk/);
  assert.doesNotMatch(candidate.migration, /CheckoutStockReservation_status_check/);
  assert.match(candidate.migration, /oidvectortypes\(procedure\.proargtypes\) = 'text, text'/);
  assert.match(candidate.migration, /76421b45f39a6d8f8888566c7fd0667f/);
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
  assert.match(
    schema,
    /@@index\(\[status, expiresAt, repairClaimedAt, id\], map: "CheckoutStockReservation_repair_claim_idx"\)/,
  );
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

test("production runner verifies then isolates the successor without applying it", () => {
  const verifySuccessor = production.indexOf(
    "checkout-stock-reservation-authority-reviewed",
  );
  const verifySuccessorRelease = production.indexOf(
    "audit:rls-checkout-stock-reservation-authority-release",
  );
  const isolateSuccessor = production.indexOf(
    "Isolate the reviewed CheckoutStockReservation successor",
  );
  const verifyForce = production.indexOf(
    "stripe-webhook-event-force-reviewed",
  );
  const apply = production.indexOf("npx prisma migrate deploy");
  assert.ok(verifySuccessor >= 0);
  assert.ok(verifySuccessorRelease > verifySuccessor);
  assert.ok(isolateSuccessor > verifySuccessorRelease);
  assert.ok(verifyForce > isolateSuccessor);
  assert.ok(apply > verifyForce);
  assert.doesNotMatch(
    production,
    /Restore (?:the reviewed )?CheckoutStockReservation successor/i,
  );
});

test("dedicated production runner and compatible runtime proof are documented separately", () => {
  assert.match(release, /checkout-stock-reservation-authority-production\.yml/);
  assert.match(release, /clean predecessor or the exact already-prepared restart state/i);
  assert.match(release, /separate pooled-runtime postflight/i);
  assert.match(release, /StripeWebhookEvent policyless FORCE with no direct runtime CRUD/i);
  assert.match(release, /seven reservation-integrity\s+counts is nonzero/i);
  assert.match(release, /31734121511[\s\S]*zero steps[\s\S]*cancelled/i);
  assert.match(release, /all 194 local migration files/i);
  assert.match(release, /listing-variants alias/i);
  assert.match(release, /DirectUpload activation pair/i);
  assert.match(release, /31745337593[\s\S]*failed[\s\S]*read-only/i);
  assert.match(
    release,
    /faf1ac4063a888e0405981aba57c177c4bbb33b184a8b315ace52152d21dc274/,
  );
  assert.match(
    release,
    /0ae1197e6d8fd936e201ac793f810a42c1358bbea70f66cabffb7415f960aad6/,
  );
  assert.match(release, /does not rewrite[\s\S]*_prisma_migrations/i);
  assert.match(
    release,
    /8c561881922143217ae31b1ef4c5f5d9894ff1d1[\s\S]*engine-enforced read-only/i,
  );
  assert.match(
    release,
    /194 reviewed migrations[\s\S]*three historical exceptions[\s\S]*productionChangedByProof: false/i,
  );
});

test("release record retains exact bytes and the no-production boundary", () => {
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, new RegExp(candidate.draftSha256));
  assert.match(release, new RegExp(verified.migrationTreeSha256));
  assert.match(release, /generic production migration workflow remains intentionally unable/i);
  assert.match(
    release,
    /does not enable or FORCE\s+CheckoutStockReservation RLS/i,
  );
});
