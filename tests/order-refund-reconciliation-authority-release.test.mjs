import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
  verifyOrderRefundReconciliationAuthorityMigrationBytes,
} from "../scripts/order-refund-reconciliation-authority-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_PHASE,
  verifyOrderRefundReconciliationAuthorityRelease,
} from "../scripts/verify-order-refund-reconciliation-authority-release.mjs";

test("release byte-pins the compatible refund reconciliation authority", () => {
  const release = verifyOrderRefundReconciliationAuthorityRelease();
  const record = readFileSync(
    "docs/order-payment-event-refund-reconciliation.md",
    "utf8",
  );
  assert.equal(release.phase, ORDER_REFUND_RECONCILIATION_AUTHORITY_PHASE);
  assert.equal(
    release.migration,
    ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  );
  assert.equal(
    release.migrationSha256,
    ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
  );
  assert.equal(
    release.predecessorMigration,
    "20260824030000_prepare_order_payment_signed_authority",
  );
  assert.equal(release.runtimeFunctions, 4);
  assert.equal(release.privateFunctions, 1);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, true);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.orderPaymentEventRlsChanged, false);
  assert.equal(release.productionTouched, false);
  assert.match(
    record,
    new RegExp(
      `SHA-256\\s+\\n?\`${ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256}\``,
    ),
  );
});

test("reconciliation migration byte verifier rejects a near match", () => {
  const root = mkdtempSync(
    path.join(tmpdir(), "grainline-refund-reconciliation-release-"),
  );
  const directory = path.join(
    root,
    "prisma/migrations",
    ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  );
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(
    `prisma/migrations/${ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION}/migration.sql`,
    "utf8",
  );
  writeFileSync(path.join(directory, "migration.sql"), `${source}\n`);
  assert.throws(
    () => verifyOrderRefundReconciliationAuthorityMigrationBytes(root),
    /migration bytes drifted/,
  );
});

test("CI isolates reconciliation before replaying the sealed predecessor", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const verify = ci.indexOf("Verify Order refund reconciliation authority release");
  const isolate = ci.indexOf("Isolate Order refund reconciliation until sealed predecessors pass");
  const verifyPredecessor = ci.indexOf("Verify Order payment signed authority release");
  const restorePredecessor = ci.indexOf("Restore Order payment signed authority release");
  const restore = ci.indexOf("Restore Order refund reconciliation authority release");
  const apply = ci.indexOf("Apply Order refund reconciliation authority preparation");
  const prove = ci.indexOf("Prove Order refund reconciliation authority in disposable PostgreSQL");
  assert.ok(verify >= 0 && verify < isolate);
  assert.ok(isolate < verifyPredecessor);
  assert.ok(verifyPredecessor < restorePredecessor);
  assert.ok(restorePredecessor < restore);
  assert.ok(restore < apply && apply < prove);
  assert.equal(
    pkg.scripts["audit:order-refund-reconciliation-authority-release"],
    "node scripts/verify-order-refund-reconciliation-authority-release.mjs",
  );
  const production = readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  const migrationPath =
    `prisma/migrations/${ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION}`;
  const productionVerify = production.indexOf(
    "Verify Order refund reconciliation authority release",
  );
  const productionIsolate = production.indexOf(migrationPath);
  const productionRestore = production.lastIndexOf(migrationPath);
  const productionApply = production.indexOf("Apply production migrations");
  assert.equal(production.split(migrationPath).length - 1, 2);
  assert.ok(productionVerify >= 0 && productionVerify < productionIsolate);
  assert.ok(
    productionIsolate < productionRestore && productionRestore < productionApply,
  );
});
