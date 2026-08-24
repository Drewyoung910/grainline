import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { repositoryAtOrderRefundRecordRelease } from "./helpers/release-verifier-root.mjs";

import {
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
  verifyOrderRefundRecordAuthorityMigrationBytes,
} from "../scripts/order-refund-record-authority-catalog.mjs";
import {
  ORDER_REFUND_RECORD_AUTHORITY_PHASE,
  verifyOrderRefundRecordAuthorityRelease,
} from "../scripts/verify-order-refund-record-authority-release.mjs";

test("release byte-pins the compatible fixed refund record authority", () => {
  const release = verifyOrderRefundRecordAuthorityRelease(
    repositoryAtOrderRefundRecordRelease(),
  );
  const releaseRecord = readFileSync(
    "docs/order-payment-event-refund-record-authority.md",
    "utf8",
  );
  assert.equal(release.phase, ORDER_REFUND_RECORD_AUTHORITY_PHASE);
  assert.equal(release.migration, ORDER_REFUND_RECORD_AUTHORITY_MIGRATION);
  assert.equal(
    release.migrationSha256,
    ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(
    release.predecessorMigration,
    "20260824010000_prepare_order_refund_claim_generation",
  );
  assert.equal(release.runtimeFunctions, 3);
  assert.equal(release.rlsChanged, false);
  assert.equal(release.runtimeTablePrivilegesChanged, false);
  assert.equal(release.productionTouched, false);
  assert.match(
    releaseRecord,
    new RegExp(`SHA-256\\s+\\n?\`${ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256}\``),
  );
});

test("refund record verifier fails closed unless the signed successor is explicit", () => {
  const root = repositoryAtOrderRefundRecordRelease();
  const unreviewed = path.join(
    root,
    "prisma/migrations/20260824030000_prepare_order_payment_signed_authority",
  );
  mkdirSync(unreviewed);
  try {
    assert.throws(
      () => verifyOrderRefundRecordAuthorityRelease(root),
      /unreviewed successor/,
    );
  } finally {
    rmSync(unreviewed, { recursive: true, force: true });
  }
});

test("record migration byte verifier rejects a near match", () => {
  const root = mkdtempSync(path.join(tmpdir(), "grainline-refund-record-release-"));
  const directory = path.join(
    root,
    "prisma/migrations",
    ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  );
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(
    `prisma/migrations/${ORDER_REFUND_RECORD_AUTHORITY_MIGRATION}/migration.sql`,
    "utf8",
  );
  writeFileSync(path.join(directory, "migration.sql"), `${source}\n`);
  assert.throws(
    () => verifyOrderRefundRecordAuthorityMigrationBytes(root),
    /migration bytes drifted/,
  );
});

test("CI isolates the record release, replays the sealed claim, then proves the record migration", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const verifyRecord = ci.indexOf("Verify Order refund record authority release");
  const isolateRecord = ci.indexOf("Isolate Order refund record authority until sealed predecessors pass");
  const verifyClaim = ci.indexOf("Verify Order refund claim generation release");
  const restoreClaim = ci.indexOf("Restore Order refund claim generation release");
  const restoreRecord = ci.indexOf("Restore Order refund record authority release");
  const applyRecord = ci.indexOf("Apply Order refund record authority preparation");
  const proveRecord = ci.indexOf("Prove atomic Order refund finalization in disposable PostgreSQL");
  assert.ok(verifyRecord >= 0);
  assert.ok(verifyRecord < isolateRecord);
  assert.ok(isolateRecord < verifyClaim);
  assert.ok(verifyClaim < restoreClaim);
  assert.ok(restoreClaim < restoreRecord);
  assert.ok(restoreRecord < applyRecord);
  assert.ok(applyRecord < proveRecord);
  assert.equal(
    pkg.scripts["audit:order-refund-record-authority-release"],
    "node scripts/verify-order-refund-record-authority-release.mjs",
  );
  assert.doesNotMatch(
    readFileSync(".github/workflows/production-migrations.yml", "utf8"),
    /20260824020000_prepare_order_refund_record_authority/,
  );
});
