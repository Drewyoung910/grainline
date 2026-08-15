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
  assert.match(release, /isolated candidate only/i);
  assert.match(release, /RLS remains\s+off/i);
  assert.match(release, /predecessor runtime table CRUD remains/i);
  assert.match(release, /fresh protected aggregate-only production inspection/i);
  assert.match(release, /policyless ENABLE/i);
  assert.match(release, /posture-only FORCE/i);
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
