import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
  verifyOrderRefundClaimGenerationMigrationBytes,
} from "../scripts/order-refund-claim-generation-catalog.mjs";
import {
  ORDER_REFUND_CLAIM_GENERATION_PHASE,
  verifyOrderRefundClaimGenerationRelease,
} from "../scripts/verify-order-refund-claim-generation-release.mjs";

test("release byte-pins one coexistence-safe refund claim successor", () => {
  const release = verifyOrderRefundClaimGenerationRelease(process.cwd(), {
    allowReviewedRefundRecordSuccessor: true,
  });
  assert.equal(release.phase, ORDER_REFUND_CLAIM_GENERATION_PHASE);
  assert.equal(release.migration, ORDER_REFUND_CLAIM_GENERATION_MIGRATION);
  assert.equal(
    release.migrationSha256,
    ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
  );
  assert.equal(
    release.predecessorMigration,
    "20260823220000_force_seller_payout_event_rls",
  );
  assert.equal(release.runtimeFunctions, 2);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.productionTouched, false);
});

test("byte verifier fails closed on a near-match migration", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-refund-claim-release-"));
  const directory = path.join(
    root,
    "prisma/migrations",
    ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  );
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(
    `prisma/migrations/${ORDER_REFUND_CLAIM_GENERATION_MIGRATION}/migration.sql`,
    "utf8",
  );
  writeFileSync(path.join(directory, "migration.sql"), `${source}\n`);

  assert.throws(
    () => verifyOrderRefundClaimGenerationMigrationBytes(root),
    /migration bytes drifted/,
  );
});
