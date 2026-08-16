import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
  verifySellerPayoutEventAuthorityRelease,
} from "../scripts/verify-seller-payout-event-authority-release.mjs";

const migrationPath =
  "prisma/migrations/20260815210000_prepare_seller_payout_event_authority/migration.sql";
const migration = readFileSync(migrationPath);
const release = readFileSync(
  "docs/seller-payout-event-compatible-authority-release.md",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");

test("SellerPayoutEvent compatible release pins the exact migration bytes and boundary", () => {
  const digest = createHash("sha256").update(migration).digest("hex");
  assert.equal(
    digest,
    SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256,
  );
  assert.match(release, new RegExp(digest));
  assert.match(release, /compatible preparation accepted in production/i);
  assert.match(release, /RLS remains\s+off/i);
  assert.match(release, /predecessor runtime table\s+CRUD remains/i);
  assert.match(release, /protected aggregate-only[\s\S]*inspection/i);
  assert.match(release, /policyless ENABLE/i);
  assert.match(release, /posture-only FORCE/i);
  assert.match(release, /31919078918/);
  assert.match(
    release,
    /2e01606f36d67787622d0a4a5efd725d5b9abdd209a29b52ce85bdb96d0075c7/,
  );
  assert.match(release, /31923317475/);
  assert.match(release, /31923608819/);
  assert.match(release, /31923767337/);
  assert.match(
    release,
    /ad6e18513ec461e70ad1f59468272f6c40b7a12113e5ddca5cdce5ed200ed8fe/,
  );
  assert.match(
    release,
    /final scope was exactly `prepared`[\s\S]*three runtime functions/i,
  );
  assert.match(
    release,
    /No application deploy[\s\S]*RLS activation[\s\S]*grant revocation occurred/i,
  );
  assert.match(release, /0 SellerPayoutEvent rows/);
  assert.match(
    release,
    /inserted`, `updated`, `legacy_converged` and `already_applied` must all[\s\S]*source-bound payout notification/i,
  );
  assert.match(
    release,
    /already_applied` must not short-circuit notification work[\s\S]*strict notification[\s\S]*rethrow a transient notification failure[\s\S]*webhook[\s\S]*retryable/i,
  );
  assert.match(
    release,
    /stale_ignored` must not emit[\s\S]*ignored_unknown_account` must not invent a recipient/i,
  );
  assert.match(
    release,
    /returned payout row ID as `sourceId`[\s\S]*independently joins that row to[\s\S]*SellerProfile/i,
  );
});

test("SellerPayoutEvent compatible verifier accepts only the byte-pinned latest candidate", () => {
  const verified = verifySellerPayoutEventAuthorityRelease();
  assert.equal(verified.migrationSha256, SELLER_PAYOUT_EVENT_AUTHORITY_MIGRATION_SHA256);
  assert.equal(verified.rlsEnabled, false);
  assert.equal(verified.rlsForced, false);
  assert.equal(verified.runtimeTablePrivilegesChanged, false);
  assert.equal(verified.runtimeFunctions, 3);
  assert.equal(verified.productionTouched, false);
});

test("CI restores payout authority only after sealed CheckoutStockReservation proofs", () => {
  const isolate = workflow.indexOf(
    "Isolate SellerPayoutEvent authority until all sealed predecessors pass",
  );
  const firstSealed = workflow.indexOf(
    "Verify CheckoutStockReservation FORCE migration tree",
  );
  const reservationFinal = workflow.indexOf(
    "Re-audit restored CheckoutStockReservation FORCE posture",
  );
  const restore = workflow.indexOf(
    "Restore SellerPayoutEvent compatible authority release",
  );
  const apply = workflow.indexOf("Apply SellerPayoutEvent compatible authority");
  const realProof = workflow.indexOf(
    "Prove SellerPayoutEvent authority in real PostgreSQL",
  );
  assert.ok(isolate >= 0 && isolate < firstSealed);
  assert.ok(reservationFinal >= 0 && reservationFinal < restore);
  assert.ok(restore < apply && apply < realProof);
  assert.match(
    workflow.slice(restore, realProof + 500),
    /audit:rls-seller-payout-event-authority-postgres/,
  );
});
